const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const root=path.resolve(__dirname,'../..'),dir=path.join(root,'packages/koatty-serve');
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):e.name.endsWith('.ts')?[path.join(dir,e.name)]:[]);}
const source=files(path.join(dir,'src'));
const lines=source.reduce((n,f)=>n+fs.readFileSync(f,'utf8').replace(/\n$/,'').split('\n').length,0);
const pkg=JSON.parse(fs.readFileSync(path.join(dir,'package.json')));
assert(lines<5000,`Serve has ${lines} source lines (limit <5000, comments and blanks included)`);
assert(!pkg.dependencies['@matrixai/quic'],'QUIC must remain optional');
console.log(JSON.stringify({files:source.length,physicalLines:lines,limit:5000,quicInCore:false,passed:true}));
