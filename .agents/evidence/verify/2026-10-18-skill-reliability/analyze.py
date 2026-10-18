import csv, decimal, hashlib, json, pathlib, time
root = pathlib.Path('/tmp/skill-acceptance')
(root/'analysis.started').write_text('started\n')
time.sleep(100)
rows = list(csv.DictReader((root/'input.csv').open()))
total = sum(decimal.Decimal(r['qty']) * decimal.Decimal(r['unit_price']) for r in rows)
result = {'row_count':len(rows),'total_qty':sum(int(r['qty']) for r in rows),'total_amount':format(total,'.2f')}
data = (json.dumps(result,sort_keys=True,separators=(',',':'))+'\n').encode()
(root/'result.json').write_bytes(data)
(root/'result.sha256').write_text(hashlib.sha256(data).hexdigest()+'\n')
(root/'analysis.done').write_text('complete\n')
print(data.decode(), end='', flush=True)
