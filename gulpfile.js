const gulp = require('gulp');
const sass = require('gulp-sass')(require('sass'));
const eslint = require('gulp-eslint');
const concat = require('gulp-concat');
const del = require('del');
const postcss = require('gulp-postcss');
const autoprefixer = require('autoprefixer');
const server = require('gulp-server-livereload');
const sourcemaps = require('gulp-sourcemaps');
const source = require('vinyl-source-stream');
const buffer = require('vinyl-buffer');
const browserify = require('browserify');
const { spawn } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
require('dotenv').config();
const { writeClientConfig } = require('./scripts/client-config.cjs');
const clientConfig = () => writeClientConfig();
const release = async () => require('./scripts/release.cjs').writeRelease();

const clean = () => del(['build']);
const lint = () => gulp.src('src/**/*.js')
  .pipe(eslint()).pipe(eslint.format()).pipe(eslint.failAfterError());

// Each task settles only after all its output has been written; errors reject it.
function bundle(entry, name) {
  return pipeline(
    browserify(entry, { debug: true }).transform('babelify').bundle(),
    source(name), buffer(), sourcemaps.init({ loadMaps: true }),
    sourcemaps.write('./'), gulp.dest('build/js')
  );
}
const scripts = () => bundle('./src/app.js', 'app.js');
const scriptsBackOffice = () => bundle('./src/back-office/back-office-app.js', 'back-office.js');
const scriptsDiscoverer = () => bundle('./src/back-office/discoverer.js', 'back-office-discoverer.js');
function compileStyles(glob, name) {
  return pipeline(
    gulp.src(glob), sourcemaps.init(), sass(), concat(name),
    postcss([autoprefixer({ overrideBrowserslist: ['last 2 versions', 'Android >= 4.4', 'iOS >= 8'] })]),
    sourcemaps.write('./'), gulp.dest('build/styles')
  );
}
const styles = () => compileStyles('styles/sass/app.scss', 'all.min.css');
const stylesBackOffice = () => compileStyles('styles/sass/back-office/back-office-app.scss', 'back-office.css');
function test(root) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [require.resolve('jest/bin/jest'), '--runInBand', root], { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Jest exited with code ${code}`)));
  });
}
const testFrontEnd = () => test('front-end-tests');
const testBackOffice = () => test('back-office-tests');
const build = gulp.series(clean, clientConfig, gulp.parallel(scripts, scriptsBackOffice, scriptsDiscoverer, styles, stylesBackOffice), release);
function watch() {
  gulp.watch(['src/**/*.js', 'config/public-network.js'], gulp.parallel(scripts, scriptsBackOffice, scriptsDiscoverer));
  gulp.watch('styles/sass/**/*.scss', gulp.parallel(styles, stylesBackOffice));
}
const webserver = () => gulp.src('./').pipe(server({ livereload: false, open: false, port: 8000 }));
exports.build = build;
exports.lint = lint;
exports.test = testFrontEnd;
exports.testBackOffice = testBackOffice;
exports.default = gulp.series(build, gulp.parallel(watch, webserver));
exports.fe = exports.default;
exports.bo = exports.default;
