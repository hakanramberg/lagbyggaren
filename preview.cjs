'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createApp}=require('./server.cjs');
const dataDir=path.join(__dirname,'.data');fs.mkdirSync(dataDir,{recursive:true});
const keyfile=path.join(dataDir,'preview-key');
const token=fs.existsSync(keyfile)?fs.readFileSync(keyfile,'utf8'):crypto.randomBytes(32).toString('hex');
if(!fs.existsSync(keyfile))fs.writeFileSync(keyfile,token,{mode:0o600});
const server=createApp({dataDir,ownerToken:token,ownerName:'Huvudtränare'});
const port=Number(process.env.PORT||4173);
server.listen(port,'127.0.0.1',()=>{
  fs.writeFileSync(path.join(dataDir,'preview-url.txt'),'http://127.0.0.1:'+server.address().port+'/#key='+token,{mode:0o600});
  console.log('Lokal förhandsvisning klar på port '+server.address().port+'. Inloggningslänken finns i .data/preview-url.txt.');
});
