'use strict';
const fs=require('node:fs'),path=require('node:path');
const file=path.resolve(__dirname,'../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html');
let html=fs.readFileSync(file,'utf8');
for(const [kind,close] of [['css','</style>'],['js','</script>']]){
 const start='/* ADDRESSBOOK-MODERN-'+kind.toUpperCase()+'-START */',end='/* ADDRESSBOOK-MODERN-'+kind.toUpperCase()+'-END */';
 let source=fs.readFileSync(path.resolve(__dirname,'../frontend/addressbook-modern.'+kind),'utf8');
 if(kind==='js')source=fs.readFileSync(path.resolve(__dirname,'../frontend/addressbook-contact-tools.js'),'utf8')+'\n'+fs.readFileSync(path.resolve(__dirname,'../frontend/addressbook-vcard.js'),'utf8')+'\n'+source;
 const block=start+'\n'+source+'\n'+end;
 const a=html.indexOf(start),b=html.indexOf(end);if(a>=0){if(b<a)throw Error('Unvollständiger Adressbuchblock');html=html.slice(0,a)+block+html.slice(b+end.length)}
 else{const i=html.lastIndexOf(close);if(i<0)throw Error('Zielblock fehlt');html=html.slice(0,i)+block+'\n'+html.slice(i)}
}
fs.writeFileSync(file,html);
