"""Pack DumpLighting's state-ordered output; no Java runtime assets are copied."""
import hashlib
import json
import struct
import sys
from pathlib import Path

raw = Path(sys.argv[1]).read_bytes()
assert len(raw) == 29873 * 196, "Expected exactly the pinned 26.1 state registry"
records, indices = {}, []
for offset in range(0, len(raw), 196):
    record = raw[offset:offset + 196]
    assert record[0] <= 15 and record[1] <= 15
    indices.append(records.setdefault(record, len(records)))
packed = struct.pack('<II', len(indices), len(records))
packed += struct.pack('<' + 'H' * len(indices), *indices) + b''.join(records)
directory = Path(__file__).resolve().parent
(directory / 'lighting-26.1.bin').write_bytes(packed)
metadata = json.loads((directory / 'lighting-26.1.json').read_text())
metadata['unique_properties'] = len(records)
metadata['sha256'] = hashlib.sha256(packed).hexdigest()
metadata['record'][3] = 'flags: skylight-down=1, shape-occlusion=2, solid-render=4, full-collision-shadow-receiver=8'
(directory / 'lighting-26.1.json').write_text(json.dumps(metadata, indent=2) + '\n')
print(f'{len(indices)} states, {len(records)} records, {len(packed)} bytes')
