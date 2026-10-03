import test from 'node:test';
import assert from 'node:assert/strict';
import { csvCell } from '../../lib/csv.ts';
test('CSV neutralizes formula/control prefixes, including LF and full-width variants',()=>{
 for(const value of ['=1+2','+1','-1','@SUM(A1)','\ttext','\rtext','\ntext','＝1+2','＋1','－1','＠SUM(A1)','  =1+2','\n＝1+2'])assert.equal(csvCell(value),'"\''+value+'"');
});
test('CSV preserves ordinary text and safely quotes separators, embedded quotes and newlines',()=>{
 for(const value of ['Alice','North-East','a@example.test','  Leading spaces','Name ＝ suffix',''])assert.equal(csvCell(value),'"'+value+'"');
 assert.equal(csvCell('a,b;"c"\nnext'),'"a,b;""c""\nnext"');
 assert.equal(csvCell('=1+2";=1+2'),'"\'=1+2"";=1+2"');
});
