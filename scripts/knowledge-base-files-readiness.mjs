import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
// Exact immutable released Publication main337c0b4 history. This is local readiness only.
const baselines={
  "20261003143058_workforce_foundation.sql": "712b7a10199b2792b8ae78cb84e3607ac8e39b3657b222bb0f13a9b3abae956b",
  "20261003153745_agents_records.sql": "a69f256d48a23529d5ffe59cc31e61e35f25a508e6a69f05b05b7c92fa14bd03",
  "20261003191154_client_rotas.sql": "9fef9156702ad18a53b39f83575ae5b24ff0327d7c2b7c329c027b79ea74dafe",
  "20261003210226_client_rota_schedule_settings.sql": "3be0294d97f6c53483da58a2badd0b22e03febe441fdc30ab00b96262fdd30cc",
  "20261003210622_chat_conversations.sql": "30a3f1590f620720d60f024f9469c30081f4c66327f4dc920b30066e7c31b54d",
  "20261003210624_chat_group_permissions.sql": "44e582b17ae7ffa5031ac968693568bc27dbb539ab829b6a932acc08500804c9",
  "20261003215100_workforce_overview_snapshot.sql": "db90ad7ba8b905b63ea1ddae9444073aefc285d9ccc68cc29cccd3115d89e141",
  "20261003215840_time_clock_baseline.sql": "8fd7dd4a4353afe4b20ea32b0dcc4b2614dd4984f820895b6da4dad41f512cc3",
  "20261003222455_quick_tasks.sql": "ce850d082c078b58c9284040be24a39bfdd2a55fec1ae442ef49460175ad2930",
  "20261003225247_team_timesheets.sql": "e93acd84c5027a3d9b12e900f18667751c09b4a9b9258ea0aa3d68e40e10d57c",
  "20261003231213_chat_message_search.sql": "d57712ae3732ab3961247ab1bf624ddbcea58e3921e77d59d760234c5a33c43a",
  "20261003232647_chat_search_execute_permissions.sql": "1e9359e3ebd90fb1ba3bbd69ca6e5d3fb7ea0242e86fff2b86552a1408ae1ed8",
  "20261003234421_time_off.sql": "68e79c5518358eae48f05503137570b7bb62fc0294a8a537eb21cecb5c226c57",
  "20261004001913_updates.sql": "3dacd9ab51e94d62a9f23390b6abe7e5063b730fa087fc4a541e57586ecbf474",
  "20261004004405_updates_engagement_export.sql": "abbcb40074d7a1100de6f757a44f70dbce97ac8b38cb37e01463b81e976b1f89",
  "20261004014158_smart_groups.sql": "4259592660bac2d4e8f5ece8ab0b29f72c4000c158143a756a8a5f47c477d2d1",
  "20261004034015_knowledge_base.sql": "9592218cee4d5cd5225a420f28728a6663060938c4af81224d587deeebb018c4",
  "20261004063200_desktop_forms.sql": "5493dd3385dc0d89acb023d9ba250ab767a1984423290bc8b23bad4ab7167875",
  "20261004080045_forms_reporting.sql": "15669683f16ccb737e0b6e703f26f845894b749bd9d26b3196f41bacca493e68",
  "20261004114249_requests_board.sql": "eeb150cf9a54609d447d7c0b1b55ab2ea830cc24b8d6a9a520ff4b699b7320aa",
  "20261004135337_knowledge_base_files.sql": "2a09283766ee33a481e0e830ac3ea6e7e27a144ceb24c3b31fbcde47890bec36",
  "20261004144511_rota_shift_templates.sql": "3df0b53fc93c2a76d3f987bfc7a6b19a031198e836f00018eb1a92612eaf20e7",
  "20261004163547_rota_visible_publication.sql": "63fcbfa5740417b2b2b3c4d168066d80275e42978ded2f38ceb318902646629a"
};
// Root pins this only after independent review of the frozen additive candidate.
const periodHash='cb83bd7b7924f428e555f39459a99c6f56ea9164c1000c1f080bd4a6cf8923a5';
export function verifyKnowledgeFileBaselines(requirePeriod=false){
 const dir=new URL('../supabase/migrations/',import.meta.url),names=readdirSync(dir).filter(name=>name.endsWith('.sql')).sort();
 const candidates=names.filter(name=>/^\d{14}_rota_period_templates\.sql$/.test(name));
 if(candidates.length>1 || requirePeriod&&candidates.length!==1)throw Error('Expected exactly one reviewed Period Templates candidate.');
 if(candidates.length && periodHash===null)throw Error('Period Templates candidate is not yet reviewed and frozen.');
 const expected=[...Object.keys(baselines),...candidates].sort();
 if(JSON.stringify(names)!==JSON.stringify(expected))throw Error('Expected exact23 applied baselines and only the optional reviewed Period Templates candidate.');
 const hashes={...baselines,...(candidates.length?{[candidates[0]]:periodHash}:{})};
 for(const[name,hash]of Object.entries(hashes)){if(createHash('sha256').update(readFileSync(new URL(name,dir))).digest('hex')!==hash)throw Error('Immutable migration byte mismatch: '+name);}
}
export function verifyRotaTemplateBaselines(){verifyKnowledgeFileBaselines();}
export function verifyRotaPublicationBaselines(){verifyKnowledgeFileBaselines();}
export function verifyRotaPeriodBaselines(){verifyKnowledgeFileBaselines(true);}
