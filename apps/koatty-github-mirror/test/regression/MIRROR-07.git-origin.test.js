const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {normalizeGitOrigin} = require('../../dist/utils/gitOrigin');

test('interactive release list renders Latest only on the designated release', async () => {
  const elements=new Map();
  const create=()=>({value:'https://github.com/a/b/releases',dataset:{},textContent:'',children:[],listeners:{},setAttribute(){},addEventListener(n,f){this.listeners[n]=f;},append(...items){this.children.push(...items);},replaceChildren(){this.children=[];}});
  const get=id=>{if(!elements.has(id))elements.set(id,create());return elements.get(id);};
  const listing={kind:'releases',source:'https://github.com/a/b/releases',limit:20,releases:[{name:'Next',tag:'next',prerelease:true,latest:false,assets:[]},{name:'Stable',tag:'stable',latest:true,assets:[]}]};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../static/site.js'),'utf8'),{
    document:{getElementById:get,querySelectorAll:()=>[],createElement:create},location:{origin:'https://du.koatty.org'},URL,
    AbortSignal:{timeout(){}},fetch:async url=>({ok:true,json:async()=>url==='/healthz'?{status:'ok'}:listing}),
  });
  await get('link-form').listeners.submit({preventDefault(){}});
  const sections=get('release-list').children;
  expect(sections[0].children[0].children).toHaveLength(0);
  expect(sections[1].children[0].children[0]).toMatchObject({className:'release-latest',textContent:'Latest · 最新版'});
});

test('Git origin configuration only accepts credential-free HTTPS origins', () => {
  expect(normalizeGitOrigin(undefined)).toBe('');
  expect(normalizeGitOrigin('https://git.koatty.org/')).toBe('https://git.koatty.org');
  for (const input of ['http://example.com','javascript:alert(1)','https://user:pass@example.com','https://example.com/path','https://example.com/?x=1','https://example.com/#x','not a URL']) {
    expect(()=>normalizeGitOrigin(input)).toThrow('MIRROR_GIT_BASE_URL');
  }
});

test.each([
  [{kind:'git',baseUrl:'https://git.koatty.org',path:'/github.com/Koatty/koatty.git'},'https://git.koatty.org/github.com/Koatty/koatty.git'],
  [{kind:'git',path:'/github.com/Koatty/koatty.git'},'https://du.koatty.org/github.com/Koatty/koatty.git'],
  [{kind:'file',baseUrl:'https://git.koatty.org',path:'/raw.githubusercontent.com/a/b/main/file'},'https://du.koatty.org/raw.githubusercontent.com/a/b/main/file'],
])('page renders and copies the correct origin for %j', async (data, expected) => {
  const elements = new Map(); let copied;
  const element = id => {
    if (!elements.has(id)) elements.set(id,{value:'https://github.com/Koatty/koatty.git',dataset:{},textContent:'',listeners:{},setAttribute(){},addEventListener(name,fn){this.listeners[name]=fn;}});
    return elements.get(id);
  };
  const context = {
    document:{getElementById:element,documentElement:{dataset:{gitOrigin:'https://git.koatty.org'}},querySelectorAll:()=>[element('prefix-example')]},location:{origin:'https://du.koatty.org',host:'du.koatty.org'},URL,
    navigator:{clipboard:{writeText:async value=>{copied=value;}}},setTimeout(){},AbortSignal:{timeout(){}},
    fetch:async url=>({ok:true,json:async()=>url==='/healthz'?{status:'ok'}:data}),
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../static/site.js'),'utf8'), context);
  expect(element('prefix-example').textContent).toBe('git.koatty.org/github.com/…');
  if(data.kind==='file') element('file-tab').listeners.click();
  await element('link-form').listeners.submit({preventDefault(){}});
  expect(element('output-url').textContent).toBe(expected);
  expect(element('output-command').textContent).toContain(expected);
  await element('copy-url').listeners.click(); expect(copied).toBe(expected);
  await element('copy-command').listeners.click(); expect(copied).toBe(element('output-command').textContent);
  expect(element('download').hidden).toBe(data.kind==='git');
});
