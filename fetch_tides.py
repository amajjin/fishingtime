import urllib.request,json,concurrent.futures,datetime,time,pathlib
root=pathlib.Path(__file__).parent/'dist'
months=[(2026,m) for m in range(10,13)]+[(2027,m) for m in range(1,13)]+[(2028,1)]
def get(ym):
 y,m=ym; ny,nm=(y+1,1) if m==12 else (y,m+1)
 u=f'https://api-iwls.dfo-mpo.gc.ca/api/v1/stations/5cebf1e33d0f4a073c4bc176/data?time-series-code=wlp-hilo&from={y}-{m:02d}-01T00:00:00Z&to={ny}-{nm:02d}-01T00:00:00Z'
 for attempt in range(3):
  try:
   data=json.load(urllib.request.urlopen(u,timeout=40));return data
  except Exception:
   if attempt==2: raise
   time.sleep(2)
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:
 batches=list(ex.map(get,months))
records=sorted({d['eventDate']:d for batch in batches for d in batch}.values(),key=lambda d:d['eventDate'])
events=[]
for i,d in enumerate(records):
 if i==0 or i==len(records)-1:continue
 kind='high' if d['value']>records[i-1]['value'] and d['value']>records[i+1]['value'] else 'low'
 events.append({'time':d['eventDate'],'height':d['value'],'type':kind})
payload={'station':'00905','timezone':'America/St_Johns','source':'https://www.tides.gc.ca/en/stations/905','retrieved':'2026-11-02','events':events}
(root/'tides.json').write_text(json.dumps(payload,separators=(',',':')))
print('Saved',len(events),'official events,',events[0]['time'],'to',events[-1]['time'])
