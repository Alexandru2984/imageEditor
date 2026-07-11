import { chromium } from '@playwright/test';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAEklEQVR4nGP8z8Dwn4EIwDiqEAAvyQP4rvqiVQAAAABJRU5ErkJggg==';
const browser = await chromium.launch({ executablePath: process.env.CHROME, args:['--enable-unsafe-webgpu'] });
const page = await browser.newPage();
const errors = [];
page.on('console', m => { if (m.type()==='error' || /fail|error|backend/i.test(m.text())) errors.push(m.text()); });
await page.goto('http://127.0.0.1:5199/', { waitUntil: 'domcontentloaded' });
await page.getByTestId('image-input').setInputFiles({ name:'t.png', mimeType:'image/png', buffer: Buffer.from(PNG,'base64') });
await page.getByText('Remove BG').click();
const outcome = await Promise.race([
  page.getByText('Background removed successfully!').waitFor({ timeout: 180000 }).then(()=>'SUCCESS'),
  page.getByText('Failed to remove background').waitFor({ timeout: 180000 }).then(()=>'APP_ERROR'),
]).catch(()=> 'TIMEOUT');
console.log('OUTCOME:', outcome);
console.log('--- full error lines ---');
errors.slice(-6).forEach(e=>console.log(e));
await browser.close();
