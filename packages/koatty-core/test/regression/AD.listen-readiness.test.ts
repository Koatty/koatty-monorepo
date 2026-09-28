import {Koatty} from '../../src/Application';
test('appStart waits for every listener and fires once even with duplicate callbacks', async () => {
 const app=new(class extends Koatty {})();const callbacks:Array<()=>void>=[];
 const server=()=>({Start:(callback:()=>void)=>{callbacks.push(callback);return 'native';}});
 app.server=[server(),server()] as any;const events=jest.fn(),ready=jest.fn();app.once('appStart',events);
 expect(app.listen(ready)).toEqual(['native','native']);
 callbacks[1]();expect(events).not.toHaveBeenCalled();expect(ready).not.toHaveBeenCalled();
 callbacks[0]();callbacks[0]();await Promise.resolve();expect(events).toHaveBeenCalledTimes(1);expect(ready).toHaveBeenCalledTimes(1);
});
