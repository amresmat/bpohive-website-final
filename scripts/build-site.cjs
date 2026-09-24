const fs = require('node:fs');
const path = require('node:path');
const cheerio = require('cheerio');
const sanitize = require('sanitize-html');
const { marked } = require('marked');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root,p),'utf8');
const json = p => JSON.parse(read(p));
const escape = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const origin = 'https://www.bpohive.com';
function validate(p, slug) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw Error('Invalid blog slug');
  for (const key of ['title','date','author','category','description','body']) if(typeof p[key]!=='string'||!p[key].trim()) throw Error(`${slug}: missing ${key}`);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(p.date)||!Number.isFinite(Date.parse(p.date))) throw Error('Invalid article date');
  if(p.featured_image && (!/^\/assets\/[a-zA-Z0-9_./-]+\.(?:png|jpe?g|webp|gif|avif)$/.test(p.featured_image)||p.featured_image.includes('..'))) throw Error('Use a local raster image in assets');
}
function renderPost(p,slug) {
  const basePath=`templates/baseline/${slug}.json`;
  if(fs.existsSync(path.join(root,basePath)) && JSON.stringify(p)===JSON.stringify(json(basePath))) return read(`blog-${slug}.html`);
  const $=cheerio.load(read('templates/article.html'));
  $('title').text(p.seo_title||p.title+' | BPO Hive');
  $('meta[name="description"],meta[property="og:description"],meta[name="twitter:description"]').attr('content',p.seo_description||p.description);
  $('meta[property="og:title"],meta[name="twitter:title"]').attr('content',p.seo_title||p.title);
  $('meta[name="keywords"]').remove();
  $('meta[name="author"],meta[property="article:author"]').attr('content',p.author);
  $('meta[property="article:published_time"]').attr('content',p.date);
  $('link[rel="canonical"]').attr('href',`${origin}/blog-${slug}`);
  $('meta[property="og:url"]').attr('content',`${origin}/blog-${slug}`);
  $('meta[property="og:image"],meta[name="twitter:image"]').attr('content',origin+(p.featured_image||'/assets/logo/landing-page-hero.webp'));
  $('header h1').text(p.title);
  $('header .flex.flex-wrap span').eq(0).text(p.category);
  $('header .flex.flex-wrap span').eq(1).text(`${Math.max(1,Math.ceil(p.body.split(/\s+/).length/220))} min read`);
  $('header .flex.flex-wrap span').eq(2).text(p.date);
  $('header p').first().text(p.description);
  $('header p.font-medium').text(p.author);
  $('header img').attr('src',p.featured_image||'/assets/logo/landing-page-hero.webp').attr('alt',p.image_alt||p.title);
  $('article').html(sanitize(marked.parse(p.body),{allowedTags:sanitize.defaults.allowedTags.concat(['img','details','summary']),allowedAttributes:{...sanitize.defaults.allowedAttributes,img:['src','alt','title','width','height'],h2:['id'],h3:['id']},allowedSchemes:['http','https','mailto','tel'],allowProtocolRelative:false}));
  const used=new Set(); const toc=[];
  $('article h2').each((i,el)=>{const h=$(el);let id=h.attr('id')||h.text().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||`section-${i}`;while(used.has(id))id+='-section';used.add(id);h.attr('id',id);toc.push(`<li><a href="#${id}">${escape(h.text())}</a></li>`);});
  $('aside ul').html(toc.join(''));
  $('aside p').text('We can map your market, test your message, and build the outreach process with you.');
  $('head').append('<style>article{line-height:1.8;overflow-wrap:anywhere}article h2{font-size:1.8rem;font-weight:700;margin:2rem 0 1rem;color:#20292f}article h3{font-size:1.35rem;font-weight:700;margin:1.5rem 0 .75rem}article p,article ul,article ol{margin-bottom:1.25rem}article ul{list-style:disc;padding-left:1.5rem}article ol{list-style:decimal;padding-left:1.5rem}article a{color:#168fdc;text-decoration:underline}article img{max-width:100%;height:auto;border-radius:12px}article table{display:block;overflow-x:auto;border-collapse:collapse;margin:1.5rem 0}article td,article th{border:1px solid #dbe8f0;padding:.75rem}article blockquote{border-left:4px solid #4EA6FE;padding-left:1rem}</style>');
  $('script[type="application/ld+json"]').remove();
  $('head').append(`<script type="application/ld+json">${JSON.stringify({'@context':'https://schema.org','@type':'BlogPosting',headline:p.title,description:p.seo_description||p.description,datePublished:p.date,dateModified:p.updated||p.date,author:{'@type':'Organization',name:p.author},publisher:{'@type':'Organization',name:'BPO Hive'},mainEntityOfPage:`${origin}/blog-${slug}`,image:origin+(p.featured_image||'/assets/logo/landing-page-hero.webp')}).replace(/</g,'\\u003c')}</script>`);
  return $.html();
}
function build(out=path.join(root,'dist')) {
  const posts=fs.readdirSync(path.join(root,'content/blog')).filter(f=>f.endsWith('.json')).map(file=>{const slug=file.slice(0,-5),p=json(`content/blog/${file}`);validate(p,slug);return {slug,...p};}).sort((a,b)=>b.date.localeCompare(a.date)||a.title.localeCompare(b.title));
  const home=json('content/site/home.json');
  let homepage=read('index.html');
  for(const [key,value] of Object.entries(home)) {if(typeof value!=='string'||!value.trim())throw Error('Invalid homepage text');const marker=new RegExp(`(<!--cms:${key}-->)[\\s\\S]*?(<!--/cms:${key}-->)`);if(!marker.test(homepage))throw Error(`Missing homepage marker ${key}`);homepage=homepage.replace(marker,(_,a,b)=>a+escape(value)+b);}
  fs.mkdirSync(out,{recursive:true});
  for(const file of fs.readdirSync(root))if(/\.(html|xml|txt|ico)$/.test(file)&&!file.startsWith('blog-'))fs.copyFileSync(path.join(root,file),path.join(out,file));
  for(const dir of ['assets','services','industries','admin'])fs.cpSync(path.join(root,dir),path.join(out,dir),{recursive:true});
  fs.writeFileSync(path.join(out,'index.html'),homepage);
  for(const {slug,...p} of posts)fs.writeFileSync(path.join(out,`blog-${slug}.html`),renderPost(p,slug));
  const $=cheerio.load(read('blogs.html'));
  const cards=posts.map(p=>`<article class="relative bg-white rounded-3xl border border-gray-100 shadow-xl overflow-hidden"><div class="p-8 md:p-12">${p.featured_image?`<img src="${escape(p.featured_image)}" alt="${escape(p.image_alt||p.title)}" loading="lazy" style="width:100%;max-height:300px;object-fit:cover;margin-bottom:24px">`:''}<p class="text-bpo-blue text-sm">${escape(p.category)} · ${escape(p.date)}</p><h2 class="text-3xl font-bold text-gray-900 mb-2"><a href="/blog-${p.slug}">${escape(p.title)}</a></h2><p class="text-gray-600 leading-relaxed mb-6">${escape(p.description)}</p><a href="/blog-${p.slug}" class="inline-flex items-center px-6 py-2 bg-[#4EA6FE] text-white font-medium rounded-full text-sm">Read article</a></div></article>`).join('\n');
  $('article').first().parent().html(cards);fs.writeFileSync(path.join(out,'blogs.html'),$.html());
  let sitemap=read('sitemap.xml').replace(/<url>\s*<loc>[^<]*\/blog-[\s\S]*?<\/url>/g,'');
  sitemap=sitemap.replace('</urlset>',posts.map(p=>`<url><loc>${origin}/blog-${p.slug}</loc><lastmod>${escape(p.updated||p.date)}</lastmod></url>`).join('\n')+'\n</urlset>');fs.writeFileSync(path.join(out,'sitemap.xml'),sitemap);
  console.log(`Built ${posts.length} blog posts and homepage content.`);
}
if(require.main===module)build();
module.exports={build,validate,renderPost};
