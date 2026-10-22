from pathlib import Path
from html.parser import HTMLParser
import re

root = Path(__file__).resolve().parent
html = (root / '晴湾公园.html').read_text(encoding='utf-8')

class AssetAudit(HTMLParser):
    def __init__(self):
        super().__init__()
        self.external = []
        self.scripts = 0
        self.ids = []
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if 'id' in attrs:
            self.ids.append(attrs['id'])
        if tag == 'script':
            self.scripts += 1
            if attrs.get('src'):
                self.external.append(attrs['src'])
        if tag in ('img', 'audio', 'video', 'source') and attrs.get('src'):
            self.external.append(attrs['src'])
        if tag == 'link' and attrs.get('rel') == 'stylesheet':
            self.external.append(attrs.get('href'))

audit = AssetAudit()
audit.feed(html)
assert audit.scripts == 5, f'Unexpected script count: {audit.scripts}'
assert not audit.external, f'External assets found: {audit.external}'
assert len(audit.ids) == len(set(audit.ids)), 'Duplicate DOM ids'
for name in ('THREE', 'ParkLife', 'ParkAudio', 'ParkScene', 'ParkUI'):
    assert name in html, name + ' missing'
assert not re.search(r'https?://[^\s]+\.(?:mp3|png|jpg|glb)', html)
print('PASS: standalone HTML includes 5 inline scripts and inline stylesheet')
print('PASS: no external script, style, image, model or audio dependencies')
print('PASS: all DOM ids are unique; scene, life, audio and UI are embedded')
print(f'Final artifact: {len(html.encode("utf-8")):,} bytes')
