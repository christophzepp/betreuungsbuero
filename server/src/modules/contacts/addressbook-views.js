'use strict';
const db=require('../../database'),A=require('./addressbook');
const keys=['query','status','city','role','institution','kind','sortBy','direction','nameOrder','missingEmail','quick','tag','group'];
const list=s=>({views:db.prepare('SELECT * FROM addressbook_views WHERE user_id=? ORDER BY label,id').all(s.userId).map(r=>({id:r.id,label:r.label,filters:JSON.parse(r.filters_json),version:r.version}))});
function save(b,s){
 if(typeof b.id!=='string'||!b.id||b.id.length>128||typeof b.label!=='string'||!b.label.trim()||b.label.length>100||!b.filters||typeof b.filters!=='object'||Array.isArray(b.filters))A.fail(400,'Bitte eine benannte Ansicht mit gültigen Filtern angeben.');
 const filters={};for(const [k,v] of Object.entries(b.filters)){if(!keys.includes(k)||typeof v!=='string'||v.length>1000)A.fail(400,'Ungültiger Ansichtsfilter.');filters[k]=v}
 db.transaction(()=>{const old=db.prepare('SELECT * FROM addressbook_views WHERE user_id=? AND id=?').get(s.userId,b.id);if((old?.version||0)!==b.version)A.fail(409,'Die Ansicht wurde inzwischen geändert. Bitte neu laden.');if(db.prepare('SELECT 1 FROM addressbook_views WHERE user_id=? AND lower(label)=lower(?) AND id<>?').get(s.userId,b.label.trim(),b.id))A.fail(409,'Dieser Ansichtsname wird bereits verwendet.');if(!old&&list(s).views.length>=100)A.fail(400,'Höchstens 100 Ansichten sind möglich.');db.prepare('INSERT INTO addressbook_views VALUES(?,?,?,?,?) ON CONFLICT(user_id,id) DO UPDATE SET label=excluded.label,filters_json=excluded.filters_json,version=excluded.version').run(b.id,s.userId,b.label.trim(),JSON.stringify(filters),(old?.version||0)+1)})();return list(s);
}
function remove(b,s){db.transaction(()=>{const r=db.prepare('SELECT version FROM addressbook_views WHERE user_id=? AND id=?').get(s.userId,b.id);if(!r)return;if(r.version!==b.version)A.fail(409,'Die Ansicht wurde inzwischen geändert. Bitte neu laden.');db.prepare('DELETE FROM addressbook_views WHERE user_id=? AND id=?').run(s.userId,b.id)})();return list(s)}
module.exports={list,save,remove};
