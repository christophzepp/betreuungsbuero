'use strict';
const fs=require('node:fs'),path=require('node:path');
const file=path.resolve(__dirname,'../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html');
let html=fs.readFileSync(file,'utf8');
for(const [ext,tag] of [['css','style'],['js','script']]){
 const id='module-headers-'+ext,source=fs.readFileSync(path.resolve(__dirname,'../frontend/module-headers.'+ext),'utf8');
 const block='<'+tag+' id="'+id+'">\n'+source+'\n</'+tag+'>';
 const start=html.indexOf('<'+tag+' id="'+id+'">');
 if(start<0){const pos=html.lastIndexOf('</body>');if(pos<0)throw Error('HTML body missing');html=html.slice(0,pos)+block+'\n'+html.slice(pos)}
 else{const end=html.indexOf('</'+tag+'>',start);if(end<0)throw Error('Incomplete module header block');html=html.slice(0,start)+block+html.slice(end+tag.length+3)}
}
fs.writeFileSync(file,html);
