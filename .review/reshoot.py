import asyncio, json, os, urllib.request
from playwright.async_api import async_playwright
API = 'http://127.0.0.1:3200'
OUT = '.review/shots'
def api(path, method='GET', data=None, token=None):
    req = urllib.request.Request(API + path, method=method,
        data=json.dumps(data).encode() if data else None,
        headers={'Content-Type': 'application/json', **({'Authorization': f'Bearer {token}'} if token else {})})
    with urllib.request.urlopen(req) as r: return json.load(r)['data']
ut = api('/auth/login', 'POST', {'phone': '13800001234', 'code': '123456'})['token']
eps = api('/episodes', 'GET', None, ut)
ep = [e for e in eps if e['status'] == '进行中'][0]
an = api('/analyses', 'POST', {'episode_id': ep['id']}, ut)
task_id = an.get('task_id')
# 等 worker 完成
import time
for _ in range(30):
    time.sleep(1)
    t = api(f"/analyses/task/{task_id}", 'GET', None, ut)
    if t['status'] != 'queued': break
aid = t.get('analysis', {}).get('id', '')
print('task:', task_id, 'analysis:', aid)
async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        shots = [
            ('app-A07-analysis', f'http://127.0.0.1:5201/#/pages/analysis/index?task_id={task_id}'),
            ('app-A08-report-diff', f'http://127.0.0.1:5201/#/pages/analysis/report?analysis_id={aid}&index=0'),
            ('app-A15-video', f'http://127.0.0.1:5201/#/pages/content/detail?id=' + api('/contents', 'GET', None, ut)[0]['id']),
        ]
        for name, url in shots:
            ctx = await browser.new_context(viewport={'width': 375, 'height': 900})
            page = await ctx.new_page()
            await page.goto('http://127.0.0.1:5201/', wait_until='domcontentloaded')
            await page.evaluate(f"localStorage.setItem('yyj_token', {json.dumps(ut)})")
            try:
                await page.goto(url, wait_until='networkidle', timeout=20000)
                await page.wait_for_timeout(2000)
                await page.screenshot(path=os.path.join(OUT, name + '.png'), full_page=True)
                print(name, 'OK')
            except Exception as e:
                print(name, 'FAIL', str(e)[:60])
            await ctx.close()
        await browser.close()
asyncio.run(main())
