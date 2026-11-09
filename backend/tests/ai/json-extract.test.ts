import { extractJsonObject, parseFillResponse } from '../../src/ai/json-extract';

describe('extractJsonObject', () => {
  it('takes the first object when the model repeats the JSON twice (real MiniMax output)', () => {
    const one = '{"title":"克莱因文集","evidence":{"author":"版权页署名“作者：（英）梅兰妮·克莱因”"}}';
    expect(extractJsonObject(one + one)).toEqual(JSON.parse(one));
  });

  it('ignores braces inside strings and surrounding text / code fences', () => {
    expect(extractJsonObject('好的：\n```json\n{"a":"x}{y","b":{"c":1}}\n```\n说明：{见上}')).toEqual({ a: 'x}{y', b: { c: 1 } });
    expect(extractJsonObject('{"q":"他说\\"}\\"了"}')).toEqual({ q: '他说"}"了' });
  });

  it('skips an invalid leading block and uses the next top-level object', () => {
    expect(extractJsonObject('{思考中} {"ok":true}')).toEqual({ ok: true });
  });

  it('does not return a nested object from a truncated reply', () => {
    expect(extractJsonObject('{"title":"x","confidence":{"author":"high"},"summary":"被截')).toBeUndefined();
    expect(extractJsonObject('no json')).toBeUndefined();
    expect(extractJsonObject('[1,2]')).toBeUndefined();
  });

  it('parseFillResponse warns and returns {} when nothing parses', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseFillResponse('抱歉，我无法确认', 'minmax')).toEqual({});
    expect(warn.mock.calls[0][0]).toContain('[ai-fill] minmax');
    warn.mockRestore();
  });
});
