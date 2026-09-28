import {Http3FrameParser,QPACKEncoder} from '../src/utils/http3';
import {Http3ServerAdapter,isMatrixaiQuicReady} from '../src';
test('importing the optional package does not eagerly load its native backend',()=>{
 expect(isMatrixaiQuicReady()).toBe(false);
 expect(new Http3FrameParser()).toBeDefined();expect(new QPACKEncoder()).toBeDefined();
 expect(new Http3ServerAdapter({hostname:'localhost',port:0,keyFile:'unused',certFile:'unused'})).toBeDefined();
});
