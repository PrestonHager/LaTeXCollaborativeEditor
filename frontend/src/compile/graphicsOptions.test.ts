import { graphicsOptionsToCss, texLengthToCss } from './graphicsOptions';

describe('texLengthToCss', () => {
  it.each([
    ['0.5\\textwidth', '50%'],
    ['.8\\linewidth', '80%'],
    ['\\columnwidth', '100%'],
    ['0.25 \\hsize', '25%'],
    ['5cm', '5cm'],
    ['12.5mm', '12.5mm'],
    ['2in', '2in'],
    ['3em', '3em'],
    ['1.5ex', '1.5ex'],
    ['100px', '100px'],
    ['72.27pt', '72pt'],
    ['72bp', '72pt'],
    ['1pc', '11.96pt'],
    ['10dd', '10.66pt'],
    ['1cc', '12.79pt'],
    ['65536sp', '1pt'],
    ['2CM', '2cm'],
  ])('reads %s as %s', (tex, css) => {
    expect(texLengthToCss(tex)).toBe(css);
  });

  it.each(['', 'cm', '5', '0.5\\textheight', '\\mylength', '0cm', '-1cm', '5furlongs', 'abc'])('gives up on %j', (tex) => {
    expect(texLengthToCss(tex)).toBeNull();
  });
});

describe('graphicsOptionsToCss', () => {
  it('fits the page when there are no size options', () => {
    expect(graphicsOptionsToCss(undefined)).toBe('max-width:100%;');
    expect(graphicsOptionsToCss('')).toBe('max-width:100%;');
    expect(graphicsOptionsToCss('angle=90, page=2')).toBe('max-width:100%;');
  });

  it('sets a relative or absolute width and leaves the height to the aspect ratio', () => {
    expect(graphicsOptionsToCss('width=0.5\\textwidth')).toBe('max-width:100%;width:50%;');
    expect(graphicsOptionsToCss(' width = 2cm ')).toBe('max-width:100%;width:2cm;');
    expect(graphicsOptionsToCss('width={0.3\\linewidth}')).toBe('max-width:100%;width:30%;');
  });

  it('sets a height without stretching the picture', () => {
    expect(graphicsOptionsToCss('height=3cm')).toBe('max-width:100%;height:3cm;object-fit:contain;');
    expect(graphicsOptionsToCss('totalheight=1in')).toBe('max-width:100%;height:1in;object-fit:contain;');
  });

  it('stretches to both sizes unless keepaspectratio is given', () => {
    expect(graphicsOptionsToCss('width=4cm,height=1cm')).toBe('max-width:100%;width:4cm;height:1cm;');
    expect(graphicsOptionsToCss('width=4cm,height=1cm,keepaspectratio')).toBe(
      'max-width:100%;width:4cm;height:1cm;object-fit:contain;',
    );
    expect(graphicsOptionsToCss('width=4cm,height=1cm,keepaspectratio=false')).toBe('max-width:100%;width:4cm;height:1cm;');
  });

  it('drops a height relative to the page, which the preview has no size for', () => {
    expect(graphicsOptionsToCss('height=0.5\\textheight')).toBe('max-width:100%;');
    expect(graphicsOptionsToCss('width=\\linewidth,height=0.5\\textheight')).toBe('max-width:100%;width:100%;');
  });

  it('scales with zoom when no width or height is given', () => {
    expect(graphicsOptionsToCss('scale=0.5')).toBe('max-width:100%;zoom:0.5;');
    expect(graphicsOptionsToCss('scale=1')).toBe('max-width:100%;');
    expect(graphicsOptionsToCss('scale=oops')).toBe('max-width:100%;');
    expect(graphicsOptionsToCss('scale=2,width=1cm')).toBe('max-width:100%;width:1cm;');
  });

  it('ignores a size it cannot read', () => {
    expect(graphicsOptionsToCss('width=\\mywidth')).toBe('max-width:100%;');
  });
});
