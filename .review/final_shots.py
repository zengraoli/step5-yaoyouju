import asyncio, json, urllib.request, time, os
from playwright.async_api import async_playwright
API = 'http://127.0.0.1:3200'
def api(path, method='GET', data=None, token=None):
    req = urllib.request.Request(API + path, method=method,
        data=json.dumps(data).encode() if data else None,
        headers={'Content-Type': 'application/json', **({'Authorization': f'Bearer {token}'} if token else {})})
    with urllib.request.urlopen(req) as r: return json.load(r)['data']
ut = api('/auth/login', 'POST', {'phone': '13800001234', 'code': '123456'})['token']
eps = api('/episodes', 'GET', None, ut)
ep = [e for e in eps if e['status'] == '进行中'][0]
an = api('/analyses', 'POST', {'episode_id': ep['id']}, ut)
tid = an.get('task_id')
for _ in range(30):
    time.sleep(1)
    t = api(f'/analyses/task/{tid}', 'GET', None, ut)
    if t['status'] != 'queued': break
aid = t.get('analysis', {}).get('id', '')
cid = api('/contents', 'GET', None, ut)[0]['id']
at = api('/admin/auth/login', 'POST', {'name': 'super01', 'password': '123456', 'totp': '123456'})['token']
SHOTS = [
    ('A08', f'http://127.0.0.1:5201/#/pages/analysis/report?analysis_id={aid}&index=0', 'yyj_token', ut, 375),
    ('A11', 'http://127.0.0.1:5201/#/pages/timeline/record', 'yyj_token', ut, 375),
    ('A15', f'http://127.0.0.1:5201/#/pages/content/detail?id={cid}', 'yyj_token', ut, 375),
    ('B05', 'http://127.0.0.1:5203/evidence', 'yyj_admin_token', at, 1440),
]
async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        for name, url, key, token, w in SHOTS:
            ctx = await browser.new_context(viewport={'width': w, 'height': 900})
            page = await ctx.new_page()
            await ctx.add_init_script(f"localStorage.setItem({json.dumps(key)}, {json.dumps(token)})")
            await page.goto(url, wait_until='networkidle', timeout=20000)
            await page.wait_for_timeout(2200)
            os.makedirs('.review/final', exist_ok=True)
            await page.screenshot(path=f'.review/final/{name}.png', full_page=True)
            print(name, 'shot saved')
            await ctx.close()
        await browser.close()
asyncio.run(main())
