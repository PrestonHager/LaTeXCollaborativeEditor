import { rewriteBraketPackage, rewriteDerivativePackage, rewritePhysics } from './mathPackageShims';

const lines = (text: string) => text.split('\n').length;

describe('physics stand-in', () => {
  it('writes derivatives as fractions, with orders, several variables and the inline star form', () => {
    expect(rewritePhysics('\\dv{f}{x}')).toBe('\\frac{\\mathrm{d} f}{\\mathrm{d} x}');
    expect(rewritePhysics('\\dv[2]{f}{x}')).toBe('\\frac{\\mathrm{d}^{2} f}{\\mathrm{d} x^{2}}');
    expect(rewritePhysics('\\dv{x}')).toBe('\\frac{\\mathrm{d}}{\\mathrm{d} x}');
    expect(rewritePhysics('\\dv*{f}{x}')).toBe('\\mathrm{d} f / \\mathrm{d} x');
    expect(rewritePhysics('\\pdv{f}{x}')).toBe('\\frac{\\partial f}{\\partial x}');
    expect(rewritePhysics('\\pdv{f}{x}{y}')).toBe('\\frac{\\partial^{2} f}{\\partial x \\, \\partial y}');
    expect(rewritePhysics('\\fdv{F}{\\phi}')).toBe('\\frac{\\delta F}{\\delta \\phi}');
  });

  it('writes differentials, with an order', () => {
    expect(rewritePhysics('\\int f \\dd{x}')).toBe('\\int f \\,\\mathrm{d}x');
    expect(rewritePhysics('\\int f \\dd x')).toBe('\\int f \\,\\mathrm{d} x');
    expect(rewritePhysics('\\dd[3]{x}')).toBe('\\,\\mathrm{d}^{3}x');
  });

  it('sizes brackets with \\left and \\right, unless starred', () => {
    expect(rewritePhysics('\\qty(\\frac12) \\qty[x] \\qty{x} \\qty|x|')).toBe(
      '\\left( \\frac12 \\right) \\left[ x \\right] \\left\\{ x \\right\\} \\left| x \\right|',
    );
    expect(rewritePhysics('\\qty((a)(b))')).toBe('\\left( (a)(b) \\right)');
    expect(rewritePhysics('\\abs{x} \\abs*{x} \\norm{v}')).toBe('\\left\\lvert x \\right\\rvert \\lvert x \\rvert \\left\\lVert v \\right\\rVert');
    expect(rewritePhysics('\\pqty{a} \\bqty{b} \\Bqty{c} \\vqty{d}')).toBe('\\left( a \\right) \\left[ b \\right] \\left\\{ c \\right\\} \\left| d \\right|');
    expect(rewritePhysics('\\order{x^2}')).toBe('\\mathcal{O}\\left( x^2 \\right)');
    expect(rewritePhysics('\\comm{A}{B} \\acomm{A}{B}')).toBe('\\left[ A, B \\right] \\left\\{ A, B \\right\\}');
  });

  it('writes \\eval as a bar that takes the limits after it', () => {
    expect(rewritePhysics('\\eval{x^2}_0^1')).toBe('\\left. x^2 \\right|_0^1');
    expect(rewritePhysics('\\eval(x^2|_0^1')).toBe('\\left( x^2 \\right|_0^1');
  });

  it('leaves \\qty to siunitx when asked', () => {
    expect(rewritePhysics('\\qty(x) \\abs{y}', { qty: false })).toBe('\\qty(x) \\left\\lvert y \\right\\rvert');
  });

  it('writes vectors and vector operators', () => {
    expect(rewritePhysics('\\vb{a} \\vb*{\\alpha} \\vu{x} \\vu*{x} \\va{r}')).toBe(
      '\\mathbf{a} \\boldsymbol{\\alpha} \\hat{\\mathbf{x}} \\hat{\\boldsymbol{x}} \\vec{\\mathrm{r}}',
    );
    expect(rewritePhysics('\\grad f \\div\\vb{E} \\curl\\vb{B} \\laplacian\\phi')).toBe(
      '\\boldsymbol{\\nabla}  f \\boldsymbol{\\nabla}\\cdot \\mathbf{E} \\boldsymbol{\\nabla}\\times \\mathbf{B} \\nabla^2 \\phi',
    );
    expect(rewritePhysics('\\tr\\rho \\Tr A \\divide')).toBe('\\operatorname{tr} \\rho \\operatorname{Tr}  A \\divide');
  });

  it('writes Dirac notation', () => {
    expect(rewritePhysics('\\bra{\\psi} \\ket{0}')).toBe('\\left\\langle \\psi \\right\\rvert \\left\\lvert 0 \\right\\rangle');
    expect(rewritePhysics('\\braket{a}{b}')).toBe('\\left\\langle a \\middle\\vert b \\right\\rangle');
    expect(rewritePhysics('\\braket{a} x')).toBe('\\left\\langle a \\middle\\vert a \\right\\rangle x');
    expect(rewritePhysics('\\expval{H} \\expval{H}{\\psi}')).toBe(
      '\\left\\langle H \\right\\rangle \\left\\langle \\psi \\middle\\vert H \\middle\\vert \\psi \\right\\rangle',
    );
    expect(rewritePhysics('\\mel{a}{H}{b}')).toBe('\\left\\langle a \\middle\\vert H \\middle\\vert b \\right\\rangle');
    expect(rewritePhysics('\\ketbra{0}{1} \\op{0}')).toBe('\\lvert 0 \\rangle\\langle 1 \\rvert \\lvert 0 \\rangle\\langle 0 \\rvert');
  });

  it('writes matrices and words between equations', () => {
    expect(rewritePhysics('\\mqty(a & b \\\\ c & d)')).toBe('\\begin{pmatrix}a & b \\\\ c & d\\end{pmatrix}');
    expect(rewritePhysics('\\mqty[1] \\mqty|1| \\mqty{1} \\pmqty{1} \\bmqty{1}')).toBe(
      '\\begin{bmatrix}1\\end{bmatrix} \\begin{vmatrix}1\\end{vmatrix} \\begin{matrix}1\\end{matrix} \\begin{pmatrix}1\\end{pmatrix} \\begin{bmatrix}1\\end{bmatrix}',
    );
    expect(rewritePhysics('x \\qq{for all} y \\qand z \\qc')).toBe('x \\quad\\text{for all}\\quad  y \\quad\\text{and}\\quad  z ,\\quad ');
  });

  it('nests, keeps line breaks, and leaves unclosed brackets alone', () => {
    expect(rewritePhysics('\\abs{\\dv{f}{x}}')).toBe('\\left\\lvert \\frac{\\mathrm{d} f}{\\mathrm{d} x} \\right\\rvert');
    const source = '\\dv{f}\n{x} \\qty(\na\n)';
    const out = rewritePhysics(source);
    expect(lines(out)).toBe(lines(source));
    expect(rewritePhysics('\\qty( \\eval( \\abs{x')).toBe('\\qty( \\eval( \\abs{x');
  });

  it('stays fast on unclosed brackets', () => {
    const started = performance.now();
    for (const input of ['\\qty('.repeat(20_000), '\\eval('.repeat(20_000), '\\qty|'.repeat(20_000), '\\braket{'.repeat(20_000)]) rewritePhysics(input);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe('derivative stand-in', () => {
  it('writes \\odv, \\pdv, \\mdv and \\fdv, with comma lists of variables', () => {
    expect(rewriteDerivativePackage('\\odv{f}{x}')).toBe('\\frac{\\mathrm{d} f}{\\mathrm{d} x}');
    expect(rewriteDerivativePackage('\\odv[2]{y}{t}')).toBe('\\frac{\\mathrm{d}^{2} y}{\\mathrm{d} t^{2}}');
    expect(rewriteDerivativePackage('\\pdv{f}{x,y}')).toBe('\\frac{\\partial^{2} f}{\\partial x \\, \\partial y}');
    expect(rewriteDerivativePackage('\\mdv{u}{t} \\fdv{F}{g}')).toBe('\\frac{\\mathrm{D} u}{\\mathrm{D} t} \\frac{\\delta F}{\\delta g}');
  });
});

describe('braket stand-in', () => {
  it('writes \\bra, \\ket, \\braket and \\set, growing the capitalized ones', () => {
    expect(rewriteBraketPackage('\\braket{\\phi|\\psi} \\ket{0} \\bra{1}')).toBe('\\langle \\phi|\\psi \\rangle \\lvert 0 \\rangle \\langle 1 \\rvert');
    expect(rewriteBraketPackage('\\Set{x | x > 0} \\set{1}')).toBe('\\left\\{ x | x > 0 \\right\\} \\{ 1 \\}');
  });
});
