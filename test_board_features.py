# -*- coding: utf-8 -*-
import json, os, re, zipfile
ROOT=os.path.dirname(os.path.abspath(__file__))
DIST=os.path.join(ROOT,'dist')
app=open(os.path.join(ROOT,'static_src','app.js'),encoding='utf-8').read()
html=open(os.path.join(ROOT,'web','index.html'),encoding='utf-8').read()
css=open(os.path.join(ROOT,'web','extra.css'),encoding='utf-8').read()

checks=[]
def T(name,cond,detail=''):
 checks.append((name,bool(cond),detail))
 print(('PASS ' if cond else 'FAIL ')+name+((' | '+detail) if detail else ''))

zy=json.load(open(os.path.join(DIST,'data','zycg','list.json'),encoding='utf-8'))
zs=json.load(open(os.path.join(DIST,'data','zycg','status.json'),encoding='utf-8'))
po=json.load(open(os.path.join(DIST,'data','poly','list.json'),encoding='utf-8'))
dates={}
for it in zy['items']:
 d=(it.get('pub_date') or it.get('publish_date') or '')[:10]
 if d:dates[d]=dates.get(d,0)+1
T('status available_dates equals actual list dates',zs.get('available_dates')==dates,repr(zs.get('available_dates')))
T('date picker replaces native input','type="hidden" id="f-date"' in html and 'id="date-grid"' in html)
T('unavailable date disabled logic','unavailable' in app and 'disabled title="该日无公告"' in app)
T('picker notice keyword search UI','id="pick-notice-key"' in html and '搜索标题 / 采购公司 / 品牌 / 品类' in html)
T('picker search covers required fields','it.purchase_company' in app and 'it.brands' in app and 'it.category' in app)
T('official notice route verified string','https://mkt.zycg.gov.cn/mall-view/information/detail?noticeId=' in app)
T('official notice click binds and fallback','bindOriginalNoticeLinks' in app and 'window.location.href = url' in app)
T('poly cards pickable','plat === "zycg" || plat === "poly"' in app)
T('poly list exports pdf_path',all('pdf_path' in x for x in po['items']))
T('poly zip builds offline HTML','polyProjectHtml' in app and 'data/poly/detail/' in app and '项目附件.zip' in app)
T('calendar mobile CSS','.date-pop { position: fixed' in css and '.notice-search-row { flex-wrap: wrap' in css)
T('all zycg pdf paths exist',all((not x.get('has_pdf')) or os.path.isfile(os.path.join(DIST,x['pdf_path'].replace('/',os.sep))) for x in zy['items']))
T('poly selection has 31 active items',po.get('total')==31,str(po.get('total')))

if not all(x[1] for x in checks):raise SystemExit(1)
print('%d/%d PASSED'%(len(checks),len(checks)))
