"""Export confirmed STS2 writes for review.html from the historical recovery workspace."""
import argparse
import ast
from collections import defaultdict
from datetime import datetime
import json
from pathlib import Path
import re


def rows(path):
    with path.open(encoding="utf-8") as stream:
        for line in stream:
            yield json.loads(line)


def output_text(output):
    if isinstance(output, list):
        return "\n".join(item.get("text", "") for item in output if isinstance(item, dict))
    return output if isinstance(output, str) else ""


def build(directory, original):
    known = {e["id"].split(":")[0] for e in original["events"]}
    old = {(e["id"].split(":")[0], datetime.fromisoformat(e["time"]), f["path"].lower())
           for e in original["events"] if e["type"] == "fileChange" for f in e["files"]}
    writes = {}
    def add(turn, call, at, path, source):
        if turn in known and path and at and source:
            key = turn, call, path.lower()
            writes.setdefault(key, (turn, at, path, call, source["source_id"], source["line"]))

    for r in rows(directory / "file-changes.jsonl"):
        if r["status"] == "completed":
            add(r["turn_id"], r["operation_id"], r["at"], r["path"], r["source"])

    candidates = {(r["turn_id"], r["call_id"]): r for r in rows(directory / "change-candidates.jsonl")}
    for turn in rows(directory / "turns.jsonl"):
        tid = turn["turn_id"]
        if tid not in known:
            continue
        calls = {e["call_id"]: e for e in turn["events"] if e.get("name") and e.get("call_id")}
        for e in turn["events"]:
            call = calls.get(e.get("call_id"))
            if not call or "output" not in e:
                continue
            output = output_text(e["output"])
            stdout = re.search(r"(?ms)^\s*status: 0,\s*stdout: (.+?),\s*stderr:", output)
            if stdout:
                try:
                    output = "".join(ast.literal_eval(part) for part in
                                     re.findall(r"'(?:\\.|[^'\\])*'", stdout[1]))
                except (SyntaxError, ValueError):
                    continue
            candidate = candidates.get((tid, e["call_id"]), {})
            # Require the actual success receipt to name the same file as the patch.
            receipt = output.partition("Success. Updated the following files:")[2]
            acknowledged = {p.replace("\\", "/").strip() for p in
                            re.findall(r"(?m)^\s*[AMD] ([^\r\n]+)", receipt)}
            for p in candidate.get("patches", []):
                if p["path"] and p["raw_path"].replace("\\", "/") in acknowledged:
                    add(tid, e["call_id"], e["at"], p["path"], e["source"])
            # Direct single apply_patch wrappers return a second text block "{}".
            parts = e["output"]
            if not (call.get("name") == "exec" and isinstance(parts, list) and len(parts) == 2
                    and parts[0].get("text", "").startswith("Script completed")
                    and parts[1].get("text", "").strip() == "{}"):
                continue
            literal = r'("(?:[^"\\]|\\.)*")'
            code = call.get("input", "").strip()
            match = re.fullmatch(r"text\(await tools\.apply_patch\(" + literal + r"\)\);?", code)
            if not match:
                match = re.fullmatch(r"const patch\s*=\s*" + literal + r";\s*text\(await tools\.apply_patch\(patch\)\);?", code)
            if match:
                for path in re.findall(r"(?m)^\*\*\* (?:Add|Update|Delete) File: (.+)$", json.loads(match[1])):
                    path = path.strip().replace("\\", "/").split("/sts2-agent-workspace/")[-1]
                    if not re.search(r"(^/|:|(?:^|/)\.\.(?:/|$))", path):
                        add(tid, e["call_id"], e["at"], path, e["source"])
    result = defaultdict(list)
    for turn, at, path, call, source, line in sorted(writes.values()):
        if (turn, datetime.fromisoformat(at), path.lower()) not in old:
            result[turn].append([at, path, call, source, line])
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("expanded", type=Path)
    directory = parser.parse_args().expanded
    root = Path(__file__).resolve().parent
    source = (root / "dataset-sts2.js").read_text(encoding="utf-8")
    recovered = build(directory, json.loads(source.split("=", 1)[1].strip().rstrip(";")))
    (root / "review-writes.js").write_text("globalThis.REVIEW_WRITES=" +
        json.dumps(recovered, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
