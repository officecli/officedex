import {it,expect} from 'vitest';
import {isInternalProposal} from './artifactPaths';
it('recognizes only reserved proposal directories, on both platforms',()=>{
 for(const path of ['/a/.officedex-proposal-123/a.docx',String.raw`C:\a\.officedex-proposal-456\a.pptx`]) expect(isInternalProposal(path)).toBe(true);
 for(const path of ['/a/a.modified.docx','/a/.officedex-proposal-123.docx','/a/user.officedex-proposal-123/a.docx']) expect(isInternalProposal(path)).toBe(false);
});
