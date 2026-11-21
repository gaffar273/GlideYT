const QRCode = require('../companion/vendor/QRCode');
let link = '';
process.stdin.setEncoding('utf8').on('data', chunk => { link += chunk; }).on('end', () => {
  const code = new QRCode(-1, 0);
  code.addData(link.trim());
  code.make();
  console.log(code.modules.map(row => row.map(Boolean).map(Number).join('')).join('\n'));
});
