"""HTTP byte-integrity/CDN probe; browser acceptance remains a separate requirement."""
import hashlib, json, subprocess, tempfile, time, urllib.request
from pathlib import Path
import sys
base = sys.argv[1].rstrip('/')
source = 'https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/'
results=[]
with tempfile.TemporaryDirectory(prefix='cog-cache-verify-') as tmp:
 for band in ['B04','B08']:
  path=f'54/T/WN/2026/10/S2B_54TWN_20261023_1_L2A/{band}.tif'
  start,end=1024,1049599
  req=urllib.request.Request(source+path,headers={'Range':f'bytes={start}-{end}'})
  with urllib.request.urlopen(req,timeout=40) as r:
   assert r.status==206
   original=r.read()
  expected=hashlib.sha256(original).hexdigest()
  attempts=[]
  for i in range(2):
   body=Path(tmp)/'body'; headers=Path(tmp)/'headers'; timing=Path(tmp)/'timing'
   cmd=['vercel','curl',f'{base}/api/cog/v1/{start}-{end}/{path}','--','--max-time','40','-sS','-o',str(body),'-D',str(headers),'-w','%{json}']
   with timing.open('w') as out:
    subprocess.run(cmd,stdout=out,stderr=subprocess.DEVNULL,check=True)
   # CLI output can precede curl JSON; no credentials or raw headers are persisted.
   raw=timing.read_text(); metrics=json.loads(raw[raw.find('{'):])
   hs={}
   for line in headers.read_text().splitlines():
    if ':' in line:
     k,v=line.split(':',1);hs[k.lower()]=v.strip()
   digest=hashlib.sha256(body.read_bytes()).hexdigest()
   assert metrics['http_code']==200 and digest==expected and len(original)==body.stat().st_size
   attempts.append({'cache':hs.get('x-vercel-cache'),'age':hs.get('age'),'range':hs.get('x-cog-range'),'bytes':body.stat().st_size,'sha256':digest,'curlTotalSeconds':metrics['time_total'],'ttfbSeconds':metrics['time_starttransfer']})
  results.append({'band':band,'sourceRange':f'bytes={start}-{end}','sourceSha256':expected,'attempts':attempts})
output={'generatedAtUnix':time.time(),'deployment':base,'note':'HTTP probe only; curl timing excludes CLI startup. No browser/image regression acceptance implied.','results':results}
p=Path('docs/testing/shared-cog-http.json');p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(output,indent=2));print(json.dumps(output,indent=2))
