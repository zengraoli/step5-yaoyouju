"""设计走查（T41）：按设计宽度截取三端页面，供与 docs/design/ 逐页对照。"""
import asyncio, json, os, urllib.request
from playwright.async_api import async_playwright

API = 'http://127.0.0.1:3200'
OUT = '.review/shots'
os.makedirs(OUT, exist_ok=True)

def api(path, method='GET', data=None, token=None):
    req = urllib.request.Request(API + path, method=method,
        data=json.dumps(data).encode() if data else None,
        headers={'Content-Type': 'application/json', **({'Authorization': f'Bearer {token}'} if token else {})})
    with urllib.request.urlopen(req) as r:
        return json.load(r)['data']

# 登录拿 token
user_token = api('/auth/login', 'POST', {'phone': '13800001234', 'code': '123456'})['token']
admin_token = api('/admin/auth/login', 'POST', {'name': 'super01', 'password': '123456', 'totp': '123456'})['token']

APP = 'http://127.0.0.1:5201/#'
WEB = 'http://127.0.0.1:5202'
ADMIN = 'http://127.0.0.1:5203'

PAGES = [
    # (名称, url, 宽度, token键, token值)
    ('app-A01-login', f'{APP}/pages/login/login', 375, None, None),
    ('app-A02-change', f'{APP}/pages/change/confirm', 375, 'yyj_token', user_token),
    ('app-A04-confusion', f'{APP}/pages/confusion/select', 375, 'yyj_token', user_token),
    ('app-A05-report', f'{APP}/pages/report/input', 375, 'yyj_token', user_token),
    ('app-A06-verify', f'{APP}/pages/report/verify', 375, 'yyj_token', user_token),
    ('app-A07-analysis', f'{APP}/pages/analysis/index', 375, 'yyj_token', user_token),
    ('app-A08-report-diff', f'{APP}/pages/analysis/report', 375, 'yyj_token', user_token),
    ('app-A09-qa', f'{APP}/pages/qa/index', 375, 'yyj_token', user_token),
    ('app-A10-timeline', f'{APP}/pages/timeline/index', 375, 'yyj_token', user_token),
    ('app-A11-today', f'{APP}/pages/timeline/record', 375, 'yyj_token', user_token),
    ('app-A12-followup', f'{APP}/pages/followup/index', 375, 'yyj_token', user_token),
    ('app-A13-contents', f'{APP}/pages/content/index', 375, 'yyj_token', user_token),
    ('app-A15-video', f'{APP}/pages/content/detail', 375, 'yyj_token', user_token),
    ('app-A14-home', f'{APP}/pages/index/index', 375, 'yyj_token', user_token),
    ('app-A16-feedback', f'{APP}/pages/feedback/index', 375, 'yyj_token', user_token),
    ('app-A17-mine', f'{APP}/pages/mine/index', 375, 'yyj_token', user_token),
    ('app-A18-fallback', f'{APP}/pages/analysis/fallback', 375, 'yyj_token', user_token),
    ('app-A03-emergency', f'{APP}/pages/emergency/notice', 375, None, None),
    ('web-W01-login', f'{WEB}/login', 1440, None, None),
    ('web-W02-dashboard', f'{WEB}/dashboard', 1440, 'yyj_web_token', user_token),
    ('web-W03-analysis', f'{WEB}/analysis', 1440, 'yyj_web_token', user_token),
    ('web-W04-qa', f'{WEB}/qa', 1440, 'yyj_web_token', user_token),
    ('web-W05-timeline', f'{WEB}/timeline', 1440, 'yyj_web_token', user_token),
    ('web-W06-followup', f'{WEB}/followup', 1440, 'yyj_web_token', user_token),
    ('web-W07-contents', f'{WEB}/contents', 1440, 'yyj_web_token', user_token),
    ('web-W08-account', f'{WEB}/account', 1440, 'yyj_web_token', user_token),
    ('web-emergency', f'{WEB}/emergency', 1440, None, None),
    ('admin-B01-login', f'{ADMIN}/login', 1440, None, None),
    ('admin-B02-dashboard', f'{ADMIN}/dashboard', 1440, 'yyj_admin_token', admin_token),
    ('admin-B03-contents', f'{ADMIN}/contents', 1440, 'yyj_admin_token', admin_token),
    ('admin-B05-evidence', f'{ADMIN}/evidence', 1440, 'yyj_admin_token', admin_token),
    ('admin-B06-feedback', f'{ADMIN}/feedback', 1440, 'yyj_admin_token', admin_token),
    ('admin-B07-safety', f'{ADMIN}/safety', 1440, 'yyj_admin_token', admin_token),
    ('admin-B08-models', f'{ADMIN}/models', 1440, 'yyj_admin_token', admin_token),
    ('admin-B10-users', f'{ADMIN}/users', 1440, 'yyj_admin_token', admin_token),
    ('admin-B11-audit', f'{ADMIN}/audit', 1440, 'yyj_admin_token', admin_token),
    ('admin-B12-cases', f'{ADMIN}/cases', 1440, 'yyj_admin_token', admin_token),
]

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        for name, url, width, key, token in PAGES:
            ctx = await browser.new_context(viewport={'width': width, 'height': 900})
            page = await ctx.new_page()
            if key and token:
                # 在页面脚本执行前注入登录态，确保应用挂载时读到
                await ctx.add_init_script(f"localStorage.setItem({json.dumps(key)}, {json.dumps(token)})")
            try:
                await page.goto(url, wait_until='networkidle', timeout=20000)
                await page.wait_for_timeout(1500)
                await page.screenshot(path=os.path.join(OUT, name + '.png'), full_page=True)
                print(name, 'OK')
            except Exception as e:
                print(name, 'FAIL', str(e)[:60])
            await ctx.close()
        await browser.close()

asyncio.run(main())
