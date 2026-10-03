import Users from '../../app/agents/users';
import type { Agent, Company, Member } from '../../lib/agent-types';
const company:Company={id:'11111111-1111-4111-8111-111111111111',name:'Northstar Demo',time_zone:'Europe/London'};
const actorId='22222222-2222-4222-8222-222222222222';
const members:Member[]=[{user_id:actorId,tenant_id:company.id,display_name:'Alex Demo',role:'owner',status:'active'}];
const agents:Agent[]=[['Alex','Demo','Coordinator','Operations'],['Taylor','Example','Agent','North'],['Jordan','Sample','Supervisor','South'],['Sam','Test','Agent','North']].map(([first_name,last_name,title,team],index)=>({id:`33333333-3333-4333-8333-${String(index).padStart(12,'0')}`,tenant_id:company.id,user_id:index===0?actorId:null,first_name,last_name,phone:'+44770090000'+index,title,team,employment_start_date:'2026-09-01',custom_fields:{},status:'active',revision:1,created_by:actorId,created_at:'2026-09-01T09:00:00Z',updated_at:'2026-09-01T09:00:00Z'}));
export default function Review(){return <Users company={company} companies={[company]} members={members} agents={agents} actorId={actorId} canManage fields={[]}/>;}
