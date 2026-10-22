"""Build an entirely local, double-clickable Willow Park HTML."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent
html = (ROOT / 'index.html').read_text(encoding='utf-8')
css = (ROOT / 'style.css').read_text(encoding='utf-8')
html = html.replace('<link rel="stylesheet" href="style.css">', '<style>\n' + css + '\n</style>')
for name in ['vendor/three.min.js', 'life.js', 'audio.js', 'scene.js', 'app.js']:
    source = (ROOT / name).read_text(encoding='utf-8')
    source = re.sub(r'</script', r'<\\/script', source, flags=re.I)
    html = html.replace('<script src="' + name + '"></script>', '<script>\n' + source + '\n</script>')
output = ROOT / '晴湾公园.html'
output.write_text(html, encoding='utf-8')
print(f'Built {output.name}: {output.stat().st_size:,} bytes')
