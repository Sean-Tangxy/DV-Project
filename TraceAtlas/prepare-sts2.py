"""Import the supplied archive as JSON data only; never execute its pipeline."""
import json
import pathlib
import zipfile

folder = pathlib.Path(__file__).resolve().parent
archive = next(folder.glob('STS2*Dataset*.zip'))
prefix = 'STS2_Agent_Dataset/'
with zipfile.ZipFile(archive) as z:
    raw = z.read(prefix + 'traceatlas-sts2/dataset.js').decode('utf-8-sig')
    data = json.loads(raw.split('=', 1)[1].strip().removesuffix(';'))
    sources = json.loads(z.read(prefix + 'derived/git-sources.json'))
    revision = data['revision']['id']
    data['testSources'] = {}
    for path, side in data['mapFiles'].items():
        if side != 'test':
            continue
        blob = sources['files'].get(path, {}).get(revision)
        if blob in sources['blobs']:
            data['testSources'][path] = {
                'text': sources['blobs'][blob], 'blob': blob,
                'revision': revision, 'at': data['revision']['at']
            }
(folder / 'dataset-sts2.js').write_text(
    'globalThis.STS2_DATA = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n', encoding='utf-8'
)
print(json.dumps({'events': len(data['events']), 'files': len(data['mapFiles']),
                  'test_sources': len(data['testSources']), 'references': len(data['references'])}))
