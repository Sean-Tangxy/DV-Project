(function (root) {
  'use strict';
  const kinds = {
    compile: '编译', probe: '运行验证', test: '测试运行器', static: '静态检查', build: '构建 / 编辑器操作'
  };
  const states = {
    pass: '通过', fail: '失败', blocked: '启动受阻', pending: '运行中（记录）', mixed: '部分通过', unknown: '结果未知', skipped: '跳过'
  };
  const fileRoles = {edit: '编辑差异', target: '明确的检查目标', diagnostic: '编译诊断位置', mention: '命令提及'};
  const fileClasses = {
    assertion: '代码／断言检查',
    mock: '模拟／假环境',
    engine: '真实引擎／场景',
    mixed: '混合信号',
    unknown: '类型未判定'
  };
  const text = value => value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value);
  const asList = x => [...new Set(x)];
  let projectName = '';
  const shell = evt => text(evt.input?.command ?? evt.input?.cmd ?? evt.input).replace(/\\{2,}/g, '\\').replace(/\\"/g, '"');
  const relPath = value => {
    let p = String(value ?? '').trim().replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\.\//, '');
    const token = '/' + projectName.toLowerCase() + '/';
    const rootAt = projectName ? p.toLowerCase().indexOf(token) : -1;
    if (rootAt >= 0) p = p.slice(rootAt + token.length);
    if (!p || /^(?:[A-Za-z]:|\/)|(?:^|\/)\.\.(?:\/|$)/.test(p) || /[*?]/.test(p)) return '';
    return p;
  };
  function paths(value) {
    const m = value.matchAll(/(?:^|[^\p{L}\p{N}_./\\:-])((?:Assets|Docs|work|Packages|ProjectSettings|UserSettings|src|tests?|app|lib|scripts|public|components|server|client)\/[\p{L}\p{N}_./@()+-]+\.[\p{L}\p{N}_-]+|(?:README(?:\.[\p{L}\p{N}_-]+)?|\.gitignore|\.gitattributes))(?=$|[^\p{L}\p{N}_./\\*-])/gimu);
    return asList([...m].map(x => relPath(x[1])).filter(Boolean));
  }
  const slash = s => s.replace(/\\/g, '/').replace(/\/+/g, '/');
  const pathInfo = (files, role) => files.map(path => ({path, role}));
  const fmt = value => typeof value === 'string' ? value : JSON.stringify(value);

  // Scan complete, top-level JSON envelopes before mixing them with shell output.
  function envelopes(log) {
    const out = [];
    const pattern = /^\s*\{/gm;
    let match;
    while ((match = pattern.exec(log))) {
      const start = match.index + match[0].lastIndexOf('{');
      let depth = 0, string = false, escaped = false;
      for (let i = start; i < log.length; i++) {
        const c = log[i];
        if (string) {
          if (escaped) escaped = false;
          else if (c === '\\') escaped = true;
          else if (c === '"') string = false;
        } else if (c === '"') string = true;
        else if (c === '{') depth++;
        else if (c === '}' && --depth === 0) {
          try {
            const obj = JSON.parse(log.slice(start, i + 1));
            if (typeof obj.success === 'boolean' && 'parameters' in obj) out.push(obj);
            pattern.lastIndex = i + 1;
          } catch {}
          break;
        }
      }
    }
    return out;
  }

  function parseEvent(e) {
    if(Array.isArray(e.providedChecks))return e.providedChecks.map((r,i)=>({
      id:e.id+':'+i,event:e,items:[],env:'',version:null,testVersion:null,...r
    }));
    if (e.type !== 'commandExecution') return [];
    const cmd = shell(e), flat = slash(cmd), out = text(e.output), rows = [];
    const push = (kind, label, status, rule, proof, extra = {}) => {
      rows.push({
        id: e.id + ':' + rows.length, event: e, kind, label, status, rule, proof: proof || '可见输出中未识别到明确结果。',
        target: label, scope: '', items: [], options: '', files: [], env: '', version: null, ...extra
      });
    };

    if (/\bcsc\.dll\b/i.test(flat)) {
      const marks = [...out.matchAll(/^[\t ]*((?:RUNTIME_|EDITOR_)?CSC_EXIT)=([\t ]*-?\d+)?[\t ]*$/gm)];
      const announced = asList([...cmd.matchAll(/\b((?:RUNTIME_|EDITOR_)?CSC_EXIT)=/g)].map(m => m[1]));
      const tags = marks.length ? [...marks, ...announced.filter(x => !marks.some(m => m[1] === x)).map(x => [null, x])] :
        announced.length ? announced.map(x => [null, x]) : [[null, /\bAssembly-CSharp-Editor\.rsp\b/i.test(cmd) ? 'EDITOR_CSC_EXIT' : null]];
      for (const [i, m] of tags.entries()) {
        const editor = m[1] === 'EDITOR_CSC_EXIT', label = editor ? 'Editor C# 编译' : '运行时 C# 编译';
        const code = m[2]?.trim(), startup = !code && /Program ['"]dotnet\.exe['"] failed to run/i.test(out) && tags.length === 1;
        const prevEnd = i && tags[i - 1].index != null ? tags[i - 1].index + tags[i - 1][0].length : 0;
        const chunk = m.index == null ? (tags.length === 1 ? out : '') : out.slice(prevEnd, m.index);
        const diag = [...slash(chunk).matchAll(/^(Assets\/[^\r\n(]+)\(\d+(?:,\d+)?\): (?:warning|error) CS\d+/gm)].map(d => relPath(d[1])).filter(Boolean);
        const rsp = asList([...flat.matchAll(/(?:@|['"])((?:Library\/)?[^\s'"]*\/Assembly-CSharp(?:-Editor)?\.rsp2?)/gi)]
          .map(x => x[1]).filter(x => editor === /-Editor\.rsp/i.test(x)));
        const explicit = [], includes = [...flat.matchAll(/\$compilerArgs\s*\+=\s*[^;\r\n]*?(Assets\/[^'"\r\n;]+\.cs)\b/gi)];
        if (editor && tags.length === 1) explicit.push(...includes.map(x => relPath(x[1])).filter(Boolean));
        push('compile', label, startup ? 'blocked' : code === '0' ? 'pass' : code ? 'fail' : 'unknown', 'CSC',
          startup ? out.split(/\r?\n/).find(s => /dotnet\.exe.*failed to run/i.test(s))?.trim() : m[0]?.trim(),
          {scope: '独立编译；不含 Unity 播放或行为断言', options: [...rsp, ...explicit].join(' · '),
            env: flat.match(/UnityHub\/Editor\/([^/]+)\/Editor/i)?.[1] ?? '',
            files: [...pathInfo(asList(diag), 'diagnostic'), ...pathInfo(asList(explicit), 'target')]});
      }
    }

    if (/Invoke-[\w.-]+Pipeline\.ps1\b/i.test(flat)) {
      const json = envelopes(out);
      const consumed = new Set();
      const param = [...flat.matchAll(/-Arguments\s+@\(\s*['"]+([a-z_]+)['"]/gi)].map(m => m[1].toLowerCase());
      for (const name of param) {
        if (!['run_script','eval','recompile','recompile_status'].includes(name)) continue;
        const j = json.findIndex((a, i) => !consumed.has(i) && (name === 'run_script' ? !!a.parameters?.file : name === 'eval' ?
          !!a.parameters?.code : !!a.result?.status && (name === 'recompile' ? !('compilationFailed' in a.result) : 'compilationFailed' in a.result)));
        if (j >= 0) consumed.add(j);
        const a = json[j], r = a?.result ?? {}, p = a?.parameters ?? {};
        if (name === 'recompile' || name === 'recompile_status') {
          const ended = r.status === 'completed', status = ended && r.compilationFailed === false && r.failed === false ? 'pass'
            : r.compilationFailed === true || r.failed === true || r.status === 'failed' ? 'fail' : r.status === 'compiling' ? 'pending' : 'unknown';
          push('compile', name === 'recompile' ? 'Unity 请求重新编译' : 'Unity 编译状态查询', status, 'PIPE-COMPILE',
            a && fmt({success: a.success, result: r}), {scope: name === 'recompile_status' ? '状态采样；不算一次新的编译启动' : '重新编译请求；接受请求不等于通过'});
          continue;
        }
        const file = relPath(p.file ?? (name === 'run_script' ? flat.match(/['"]--file['"]\s*,\s*['"]([^'"]+)['"]/i)?.[1] : ''));
        const entry = p.entry ?? (name === 'run_script' ? flat.match(/['"]--entry['"]\s*,\s*['"]([^'"]+)['"]/i)?.[1] : null) ?? '';
        const result = Array.isArray(r.result) ? r.result : [];
        const observations = result.filter(s => typeof s === 'string' && /^(?:PASS|FAIL|SKIP):\s/i.test(s));
        const isAudit = observations.length > 0 || /audit|verification|inspect|probe|(?:^|[/.])verify\b/i.test(file + ' ' + entry) ||
          name === 'eval' && /\b(?:throw new|Require\s*\(|Assert\.)/.test(p.code ?? '');
        const isBuild = !isAudit && name === 'eval' && /(?:Builder|Build)\.\w+\(/.test(p.code ?? '');
        if (!isAudit && !isBuild) continue;
        const label = entry || (isBuild ? p.code.match(/[\w.]+\(/)?.[0].slice(0,-1) : 'Unity 表达式探针') || file;
        const blocked = !a && param.length === 1 && /连接失败|无法连接|actively refused|connection refused|ETIMEDOUT/i.test(out);
        const status = blocked ? 'blocked' : a?.success === false ? 'blocked' :
          r.success === false ? 'fail' : r.success === true ? (observations.some(s => /^FAIL:/i.test(s)) ?
            observations.some(s => /^PASS:/i.test(s)) ? 'mixed' : 'fail' : 'pass') : 'unknown';
        const items = observations.map(value => {
          const [, tag, label] = value.match(/^(PASS|FAIL|SKIP):\s*(.*)/i);
          return {name: label, type: '脚本自报观测', status: {PASS:'pass',FAIL:'fail',SKIP:'skipped'}[tag.toUpperCase()]};
        });
        push(isBuild ? 'build' : 'probe', label, status, 'PIPE-SCRIPT', a ?
          fmt({success: a.success, scriptSuccess: r.success, result: r.errorDetails || r.error || r.result}) : blocked ? out : '',
          {scope: isBuild ? 'Unity 编辑器内运行构建入口' : 'Unity 管线返回值；逐条观测是脚本输出，不等同独立测试用例',
            target: file ? file + '#' + entry : p.code ?? label, options: [file, entry, p.code].filter(Boolean).join(' · '), items,
            files: file ? pathInfo([file], 'target') : [],
            duration: Number.isFinite(r.executeMs) ? r.executeMs : null});
      }
    }

    const methods = [...flat.matchAll(/-executeMethod['", ]+([\w.]+)/gi)];
    if (/\bUnity\.exe\b/i.test(flat) && methods.length) {
      const unityExit = out.match(/^\s*UNITY_EXIT=(-?\d+)\s*$/m)?.[1];
      for (const [, method] of methods) {
        const stage = /(?:Verify|BeginPlay|Audit|TestRunner)/i.test(method) ? 'probe' : 'build';
        push(stage, method, methods.length > 1 || unityExit == null ? 'unknown' : Number(unityExit) === 0 ? 'pass' : 'fail',
          'UNITY-BATCH', unityExit == null ? '' : 'UNITY_EXIT=' + unityExit,
          {env: flat.match(/UnityHub\/Editor\/([^/]+)\/Editor/i)?.[1] ?? '', options: method,
            scope: '批处理入口结果；不等于用例断言或场景视觉通过'});
      }
    }

    if (/(?:^|[\s'";|&])(?:python(?:3|\.exe)?\s+-m\s+pytest|pytest|dotnet\s+test|npm\s+test|npx\s+(?:vitest|jest)|node\s+--test)\b/i.test(flat) ||
      /\bUnity\.exe\b[\s\S]*\s-runTests(?=\s|[,'"])/i.test(flat)) {
      const runner = flat.match(/\b(?:pytest|dotnet\s+test|npm\s+test|vitest|jest|node\s+--test|-runTests)\b/i)?.[0] ??
        (flat.includes('-runTests') ? 'Unity -runTests' : '测试运行器');
      const p = out.match(/^\s*(?:=+\s*)?(\d+)\s+passed\b[^\r\n]*$/im);
      const f = out.match(/^\s*(?:=+\s*)?(\d+)\s+failed\b[^\r\n]*$/im);
      const terminal = p?.[0] ?? f?.[0];
      const pCount = Number(terminal?.match(/(\d+)\s+passed\b/i)?.[1] ?? 0);
      const fCount = Number(terminal?.match(/(\d+)\s+failed\b/i)?.[1] ?? f?.[1] ?? 0);
      push('test', runner, fCount ? pCount ? 'mixed' : 'fail' : pCount > 0 && e.exit_code === 0 ? 'pass' : 'unknown',
        'RUNNER', terminal, {scope: '运行器输出；未建立逐用例结果关联', options: paths(flat).join(' · '), summaryCount: pCount || null});
    }

    const diff = flat.match(/\bgit\s+diff\s+(?:--cached\s+)?--check\b([^\r\n;&|]*)/i);
    if (diff) {
      const files = paths(diff[1]), standalone = !/[;\r\n]|&&|\|\|/.test(flat.slice(diff.index));
      const reported = /^[^\r\n]+:\d+: (?:trailing whitespace|space before tab in indent|new blank line at EOF|leftover conflict marker)/im.test(out);
      const status = reported ? 'fail' : standalone && e.exit_code === 0 ? 'pass' : 'unknown';
      push('static', 'git diff --check', status, 'GIT-CHECK', reported ? out.split(/\r?\n/).find(s => /trailing whitespace|space before tab|new blank line at EOF|leftover conflict marker/i.test(s)) :
        status === 'pass' ? '独立 diff 检查命令退出 0。' : '组合命令：外层退出码无法独立归到 diff 检查。',
        {scope: '仅检查 diff 中的空白／冲突标记', target: (diff[0].includes('--cached') ? '暂存区' : '工作区') + ' · ' + (files.slice().sort().join(', ') || '默认 diff'),
          options: files.join(' · '), files: pathInfo(files, 'target')});
    }
    return rows;
  }

  function folder(path) {
    const p = path.split('/');
    if (p.length === 1) return '项目根目录';
    if (p.length === 2 || p[0] !== 'Assets') return p[0];
    return p.slice(0, 2).join('/');
  }

  function build(data) {
    projectName = data.project || '';
    const sessions = new Map(data.sessions.map((s,i) => [s.id,{...s, index:i + 1, code:'S' + String(i + 1).padStart(2,'0'), events:[]}]));
    const rels = new Map((data.relations ?? []).map(r => [r.id, r]));
    const events = data.events.map((e,i) => ({...e, index:i, files: Array.isArray(e.files) ? e.files : [], checks: []}));
    const byId = new Map(), checks = [], subjects = new Map(), files = new Map();
    for(const [path,side] of Object.entries(data.mapFiles??{}))files.set(path.toLowerCase(),{
      path,side,group:path.slice(0,path.lastIndexOf('/'))||'项目根目录',events:new Map(),checks:new Set(),signals:[]
    });
    function addFile(p, e, role, run) {
      if (!p) return;
      const key = p.toLowerCase();
      if (!files.has(key)) files.set(key, {path:p, group:folder(p), events:new Map(), checks:new Set(), signals:[]});
      const f = files.get(key);
      if (!f.events.has(e.id)) f.events.set(e.id, new Set());
      f.events.get(e.id).add(role);
      if (run) f.checks.add(run.id);
    }
    function addSignal(p, value) {
      if (!p || !value) return;
      const f = files.get(p.toLowerCase());
      if (!f) return;
      // Keep enough local evidence for classification without copying the whole log repeatedly.
      if (f.signals.length < 18) f.signals.push(String(value).slice(0, 30000));
    }
    function classifyFile(f) {
      const pathText = f.path.replace(/\\/g, '/');
      const text = (pathText + '\n' + f.signals.join('\n')).toLowerCase();
      const scores = {assertion: 0, mock: 0, engine: 0};
      const hit = (kind, patterns, weight=1) => patterns.forEach(pattern => { if (pattern.test(text)) scores[kind] += weight; });
      // File names frequently use CamelCase (MainMapTestSession.cs), so a
      // word-boundary-only scan would miss the strongest test-file signal.
      hit('assertion', [/(?:^|[/_.-])(?:test|tests|verify|verification|audit|assert|assertion|check|validation|lint)(?:[/_.-]|$)/i, /(?:Test|Tests|Verify|Verification|Audit|Assert|Assertion|Check|Validation|Lint)(?:[A-Z0-9_.-]|$)/i], 3);
      hit('mock', [/(?:^|[/_.-])(?:mock|fake|stub|fixture|sandbox|simulation|simulator|dummy|in-memory|inmemory|testdouble)(?:[/_.-]|$)/i, /(?:Mock|Fake|Stub|Fixture|Sandbox|Simulation|Simulator|Dummy)(?:[A-Z0-9_.-]|$)/i], 3);
      hit('engine', [/(?:^|[/_.-])(?:unity|scene|scenes|prefab|gameobject|monobehaviour|playmode|editmode|physics|collider|assetdatabase)(?:[/_.-]|$)/i, /\.(?:unity|prefab)$/i, /(?:Scene|Prefab|GameObject|MonoBehaviour|PlayMode|EditMode|Physics|Collider)(?:[A-Z0-9_.-]|$)/i], 3);
      hit('mock', [/\bmock\w*/i, /\bfake\w*/i, /\bstub\w*/i, /\bfixture\w*/i, /\bsandbox\b/i, /\bsimulat(?:e|ion|ed)/i, /in[- ]memory/i, /dummy/i, /模拟|假环境|测试替身/i], 2);
      hit('engine', [/\bunity(?:engine|editor)?\b/i, /playmode|editmode|scene|prefab|assetdatabase|gameobject|monobehaviour/i, /getcomponent|findobject|physics|collider|executeMethod|runTests/i, /\.unity\b|\.prefab\b/i, /真实引擎|真实场景/i], 2);
      hit('assertion', [/\bassert(?:ion)?\b|\bexpect\b|\bshould\b|\bverify\w*\b|\bvalidation\b|\baudit\b|\bprobe\b/i, /\btest\w*\b|\bcheck\w*\b|\blint\b|syntax|compile|diff --check|passed|failed/i, /断言|验证|校验|正确性|静态检查/i], 2);
      const kinds = Object.keys(scores).filter(k => scores[k] > 0);
      if (!kinds.length) return 'unknown';
      if (kinds.length > 1 && kinds.some(k => scores[k] > 1)) return 'mixed';
      return kinds.sort((a,b) => scores[b] - scores[a])[0];
    }
    for (const e of events) {
      if (!sessions.has(e.session)) throw new Error('Event references an unknown session');
      if (byId.has(e.id)) throw new Error('Duplicate record ID: ' + e.id);
      sessions.get(e.session).events.push(e);
      byId.set(e.id,e);
      e.editPaths = asList(e.files.map(f => relPath(f.path)).filter(Boolean));
      e.editPaths.forEach(p => addFile(p, e, 'edit'));
      const commandText = e.type === 'commandExecution' ? shell(e) : '';
      if (e.type === 'commandExecution'&&!data.mapFiles) paths(slash(commandText)).forEach(p => addFile(p,e,'mention'));
      e.files.forEach(raw => {
        const p = relPath(raw.path);
        addSignal(p, [raw.diff, commandText, text(e.output)].filter(Boolean).join('\n'));
      });
      e.checks = parseEvent(e);
      for (const r of e.checks) {
        r.group = JSON.stringify([e.session, r.kind, r.label, r.target]);
        if (!subjects.has(r.group)) subjects.set(r.group, []);
        subjects.get(r.group).push(r);
        checks.push(r);
        r.files.forEach(f => {
          addFile(f.path,e,f.role,r);
          addSignal(f.path, [r.label, r.target, r.options, r.scope, commandText, text(e.output)].filter(Boolean).join('\n'));
        });
      }
    }
    for (const s of sessions.values()) {
      s.relation = rels.get(s.id);
      s.events.sort((a,b)=>a.ordinal-b.ordinal||a.index-b.index);
      s.events.forEach((e,i)=>{ e.seq = i; });
    }
    for (const group of subjects.values()) group.sort((a,b)=>a.event.seq-b.event.seq);
    const runById = new Map(checks.map(r => [r.id,r]));
    for (const f of files.values()) f.classification = classifyFile(f);
    return {data,sessions,events,checks,subjects,files,byId,runById,fileClasses};
  }

  function compare(a,b) {
    return [
      ['检查目标', a.target, b.target], ['产品版本', a.version, b.version],
      ['测试版本', a.testVersion, b.testVersion], ['可见参数 / 入口', a.options, b.options],
      ['已知环境', a.env, b.env], ['检查结果', states[a.status], states[b.status]]
    ].map(([label, left, right]) => ({
      label, left: left || null, right: right || null,
      mode: !left || !right ? 'unknown' : left === right ? 'same' : 'changed'
    }));
  }
  root.VerificationModel = {kinds, states, fileRoles, build, compare, text, parseEvent};
})(globalThis);
