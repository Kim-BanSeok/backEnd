// 양주시청 허가과 게시판(bbsNo=66)에서 최신 "N년 M월말 공장등록 현황" 첨부를 받는다.
// 같은 첨부 번호가 이미 있으면 다시 받지 않는다. 매월 작업 스케줄러에서 이 파일을 실행하면 된다.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import sequelize from '../src/db/connection.js';
import { saveFactoryWorkbook } from './import-yangju-factories.js';

const BOARD = 'https://yjcc.yangju.go.kr/www';
const LIST_URL = `${BOARD}/selectBbsNttList.do?bbsNo=66&key=563&pageIndex=1`;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'data/factories/yangju-city');
const TITLE = /(\d{4})년\s*(\d{1,2})월말\s*공장등록\s*현황/;

const decode = (value) => value.replace(/&amp;/g, '&').replace(/&quot;/g, '"');
const jar = new Map();

function keepCookies(response) {
  for (const line of response.headers.getSetCookie?.() ?? []) {
    const pair = line.split(';')[0];
    jar.set(pair.split('=')[0], pair);
  }
}

async function html(url) {
  const response = await fetch(url, { headers: { Cookie: [...jar.values()].join('; ') } });
  keepCookies(response);
  if (!response.ok) throw new Error(`게시판 요청 실패 ${response.status}: ${url}`);
  return response.text();
}

function latestPost(page) {
  const posts = [];
  const row = /<a href="\.\/selectBbsNttView\.do\?([^"]+)"[^>]*>[\s\S]*?(\d{4}년\s*\d{1,2}월말\s*공장등록\s*현황)/g;
  for (const match of page.matchAll(row)) {
    const title = match[2].replace(/\s+/g, ' ').trim();
    const parsed = TITLE.exec(title);
    if (!parsed) continue;
    const params = new URLSearchParams(decode(match[1]));
    posts.push({
      title,
      year: Number(parsed[1]),
      month: Number(parsed[2]),
      nttNo: params.get('nttNo'),
    });
  }
  posts.sort((a, b) => b.year - a.year || b.month - a.month);
  return posts[0] ?? null;
}

function attachment(page) {
  const file = page.match(/<span><img[^>]*>\s*([^<]+\.xls[x]?)\s*<\/span>/i);
  const link = page.match(/href="(\/www\/previewUrl\.do\?[^"]+)"/);
  if (!file || !link) throw new Error('첨부 파일 주소를 찾지 못했습니다.');
  const params = new URLSearchParams(decode(link[1].split('?')[1]));
  return {
    filename: file[1].trim(),
    atchmnflNo: params.get('atchmnflNo'),
    previewUrl: `https://yjcc.yangju.go.kr${decode(link[1])}`,
  };
}

// 다운로드 버튼은 "첨부파일을 확인할 수 없습니다"를 돌려준다.
// 미리보기가 가리키는 /DATA/bbs/66/ 파일은 공개 엑셀이라 그 주소를 받는다.
async function fileUrl(previewUrl) {
  const response = await fetch(previewUrl, {
    headers: { Cookie: [...jar.values()].join('; ') },
    redirect: 'manual',
  });
  keepCookies(response);
  const location = response.headers.get('location') ?? '';
  const name = new URL(location, BOARD).searchParams.get('fn');
  if (!name || !/^[\w.-]+\.xls[x]?$/i.test(name)) throw new Error('미리보기에서 파일 이름을 찾지 못했습니다.');
  return `https://yjcc.yangju.go.kr/DATA/bbs/66/${name}`;
}

const latest = latestPost(await html(LIST_URL));
if (!latest?.nttNo) throw new Error('공장등록 현황 글을 찾지 못했습니다.');

const file = attachment(await html(`${BOARD}/selectBbsNttView.do?key=563&bbsNo=66&nttNo=${latest.nttNo}`));
file.url = await fileUrl(file.previewUrl);
const stamp = `${latest.year}-${String(latest.month).padStart(2, '0')}`;
const dir = path.join(OUT_DIR, stamp);
const dest = path.join(dir, file.filename);
const marker = path.join(dir, 'source.json');

let downloaded = true;
try {
  const saved = JSON.parse(await fs.readFile(marker, 'utf8'));
  if (saved.atchmnflNo === file.atchmnflNo && saved.sha256 && saved.byteLength && saved.datasetMonth === stamp) {
    console.log(`already downloaded ${stamp} ${file.filename}`);
    downloaded = false;
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

if (downloaded) {
  const response = await fetch(file.url);
  if (!response.ok) throw new Error(`파일 다운로드 실패 ${response.status}`);
  const body = Buffer.from(await response.arrayBuffer());
  const ole = body.subarray(0, 4).toString('hex');
  const zip = body.subarray(0, 2).toString('utf8');
  if (ole !== 'd0cf11e0' && zip !== 'PK') throw new Error('받은 내용이 엑셀 파일이 아닙니다.');

  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(dest, body);
  await fs.writeFile(marker, `${JSON.stringify({
    title: latest.title,
    nttNo: latest.nttNo,
    atchmnflNo: file.atchmnflNo,
    filename: file.filename,
    url: file.url,
    downloadUrl: file.url,
    datasetMonth: stamp,
    publisher: '양주시청 허가과',
    sheetName: '공장등록현황',
    sha256: createHash('sha256').update(body).digest('hex'),
    byteLength: body.length,
    downloadedAt: new Date().toISOString(),
  }, null, 2)}\n`);
  console.log(`downloaded ${stamp} ${file.filename} (${body.length} bytes)`);
}

try {
  await saveFactoryWorkbook({ dir, stamp });
} finally {
  await sequelize.close();
}
