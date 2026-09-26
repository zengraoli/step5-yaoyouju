"""最终复验：ASCII 输出，确认无控制台错误 / 无失败请求 / 无 4xx"""
import asyncio, json, urllib.request, time
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
PAGES = [
    ('APP-A08-report-diff', f'http://127.0.0.1:5201/#/pages/analysis/report?analysis_id={aid}&index=0', 'yyj_token', ut),
    ('APP-A09-qa', 'http://127.0.0.1:5201/#/pages/qa/index', 'yyj_token', ut),
    ('APP-A10-timeline', 'http://127.0.0.1:5201/#/pages/timeline/index', 'yyj_token', ut),
    ('APP-A11-today', 'http://127.0.0.1:5201/#/pages/timeline/record', 'yyj_token', ut),
    ('APP-A12-followup', 'http://127.0.0.1:5201/#/pages/followup/index', 'yyj_token', ut),
    ('APP-A15-video', f'http://127.0.0.1:5201/#/pages/content/detail?id={cid}', 'yyj_token', ut),
    ('ADMIN-B05-evidence', 'http://127.0.0.1:5203/evidence', 'yyj_admin_token', at),
    ('ADMIN-B10-users', 'http://127.0.0.1:5203/users', 'yyj_admin_token', at),
    ('ADMIN-B09-eval', 'http://127.0.0.1:5203/eval', 'yyj_admin_token', at),
]
async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        bad = 0
        for name, url, key, token in PAGES:
            ctx = await browser.new_context(viewport={'width': 375 if 'APP' in name else 1440, 'height': 900})
            page = await ctx.new_page()
            errs, resp4 = [], []
            page.on('console', lambda m: errs.append(m.text[:160]) if m.type == 'error' else None)
            page.on('pageerror', lambda e: errs.append(str(e)[:160]))
            page.on('response', lambda r: resp4.append(f'{r.status}') if r.status >= 400 else None)
            await ctx.add_init_script(f"localStorage.setItem({json.dumps(key)}, {json.dumps(token)})")
            await page.goto(url, wait_until='networkidle', timeout=20000)
            await page.wait_for_timeout(2500)
            ok = not errs and not resp4
            if not ok:
                bad += 1
            print(f'{"PASS" if ok else "FAIL"}  {name}  console_errors={len(errs)} http4xx={len(resp4)}')
            for e in errs[:3]:
                print('   ERR:', e)
            await ctx.close()
        await browser.close()
        print(f'RESULT: {len(PAGES) - bad}/{len(PAGES)} pages clean')
asyncio.run(main())
