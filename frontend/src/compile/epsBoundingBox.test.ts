import { parseEpsBoundingBox } from './epsBoundingBox';

const bytes = (text: string) => new TextEncoder().encode(text);

describe('parseEpsBoundingBox', () => {
  it('reads %%BoundingBox from the header', () => {
    expect(parseEpsBoundingBox(bytes('%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 10 20 154 92\n%%EndComments\n'))).toEqual({ width: 144, height: 72 });
  });

  it('prefers %%HiResBoundingBox, and handles CR line ends', () => {
    const text = '%!PS\r%%BoundingBox: 0 0 101 51\r%%HiResBoundingBox: 0 0 100.5 50.25\r';
    expect(parseEpsBoundingBox(bytes(text))).toEqual({ width: 100.5, height: 50.25 });
  });

  it('looks in the trailer when the header says (atend)', () => {
    const text = `%!PS\n%%BoundingBox: (atend)\n${'x'.repeat(20000)}\n%%Trailer\n%%BoundingBox: 0 0 30 40\n%%EOF\n`;
    expect(parseEpsBoundingBox(bytes(text))).toEqual({ width: 30, height: 40 });
  });

  it('reads the PostScript part of a DOS EPS file', () => {
    const ps = bytes('%!PS\n%%BoundingBox: 0 0 20 10\n');
    const file = new Uint8Array(30 + ps.length);
    file.set([0xc5, 0xd0, 0xd3, 0xc6]);
    const view = new DataView(file.buffer);
    view.setUint32(4, 30, true);
    view.setUint32(8, ps.length, true);
    file.set(ps, 30);
    expect(parseEpsBoundingBox(file)).toEqual({ width: 20, height: 10 });
  });

  it('gives null when there is no usable box', () => {
    expect(parseEpsBoundingBox(bytes('%!PS\nshowpage\n'))).toBeNull();
    expect(parseEpsBoundingBox(bytes('%!PS\n%%BoundingBox: 0 0 0 10\n%%BoundingBox: a b c d\n'))).toBeNull();
    expect(parseEpsBoundingBox(bytes('%!PS\n%%BoundingBox: (atend)\n'))).toBeNull();
  });
});
