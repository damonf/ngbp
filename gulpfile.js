/*globals require: false*/ 
/*jshint strict: false*/

//////////////////////////////////////////////////////////////////////

var
  gulp        = require('gulp'),
  gutil       = require('gulp-load-utils')(['date', 'log', 'colors']),
  header      = require('gulp-header'),
  del         = require('del'),
  concat      = require('gulp-concat'),
  uglify      = require('gulp-uglify'),
  changed     = require('gulp-changed'),
  merge       = require('merge-stream'),
  minifyHtml  = require("gulp-minify-html"),
  ngHtml2Js   = require("gulp-ng-html2js"),
  jshint      = require('gulp-jshint'),
  stylish     = require('jshint-stylish'),
  _less       = require('gulp-less'),
  CleanCSS    = require('less-plugin-clean-css'),
  cleancss    = new CleanCSS({ advanced: true }),
  sourcemaps  = require('gulp-sourcemaps'),
  _ngAnnotate = require('gulp-ng-annotate'),
  rename      = require('gulp-rename'),
  inject      = require('gulp-inject'),
  source      = require('vinyl-source-stream'),
  process     = require('process'),
  vinylBuffer = require('vinyl-buffer'),
  eventStream = require('event-stream'),
  globby      = require("globby"),
  karma       = require('karma').server,
  _livereload = require('gulp-livereload'),
  cached      = require('gulp-cached'),
  pkg         = require('./package.json'),
  config      = require( './build.config.js' ),

  opt  = {
    pkg  : pkg,
    date : gutil.date("yyyy-mm-dd")
  },

  banner = [
    '/**',
    ' * <%= pkg.name %> - v<%= pkg.version %> - <%= date %>',
    ' * <%= pkg.homepage %>',
    ' *',
    ' * Copyright (c) <%= new Date().getFullYear() %> <%= pkg.author %>',
    ' * Licensed <%= pkg.licenses.type %> <<%= pkg.licenses.url %>>',
    ' */\n'
  ].join('\n');

// cleans the build directories
function clean(done) {
  del([config.build_dir, config.compile_dir], done);
}

// copy our project assets (images, fonts, etc.) and javascripts into
// the build dir (dev)
function copy() {
  var
    appAssets =
      gulp.src('src/assets/**/*', {
          base: 'src/assets/'
      })
      .pipe(changed(config.build_dir + '/assets'))
      .pipe(gulp.dest(config.build_dir + '/assets')),

    vendorAssets =
      gulp.src(config.vendor_files.assets, {
        base: '.'
      })
      .pipe(changed(config.build_dir + '/assets'))
      .pipe(gulp.dest(config.build_dir + '/assets')),

    // TODO: combine all these ...
    appJs =
      gulp.src(config.app_files.js, {
        base: '.'
      })
      .pipe(changed(config.build_dir))
      .pipe(gulp.dest(config.build_dir)),

    vendorJs =
      gulp.src(config.vendor_files.js, {
        base: '.'
      })
      .pipe(changed(config.build_dir))
      .pipe(gulp.dest(config.build_dir)),

    vendorCss =
      gulp.src(config.vendor_files.css, {
        base: '.'
      })
      .pipe(changed(config.build_dir))
      .pipe(gulp.dest(config.build_dir));

  return merge([
    appAssets,
    vendorAssets,
    appJs,
    vendorJs,
    vendorCss
  ]);
}

// copy assets (our css + anything else) and vendor css to the compile dir
//
function copyCompileAssets() {
  var
    assets =
      gulp.src(config.build_dir + '/assets/**/*', {
        base: config.build_dir + '/assets/'
      })
      .pipe(changed(config.compile_dir + '/assets'))
      .pipe(gulp.dest(config.compile_dir + '/assets')),

    vendorCss =
      gulp.src(config.vendor_files.css, {
        base: '.'
      })
      .pipe(changed(config.compile_dir))
      .pipe(gulp.dest(config.compile_dir));

  return merge([
    assets,
    vendorCss
  ]);
}

// `ngAnnotate` annotates the sources before minifying.
//
function ngAnnotate() {
  return gulp.src(config.app_files.js, {
      cwd: config.build_dir,
      base: config.build_dir
    })
    .pipe(_ngAnnotate({ add: true }))
    .pipe(gulp.dest(config.build_dir));
}

// put all the template files into javascript files and copy them into
// the build dir (dev)
// (generate .js files from .tpl.html files to be injected into the template cache)
//
var
  templatesApp    = 'templates-app',
  templatesCommon = 'templates-common';

function html2js() {
  var
    // we always want to declare the modules even if there are no
    // templates, so here we have a default empty template.
    // Without this is will not generate any output if the src
    // glob doesnt match any files
    emptyStream = function () {
      var stream = source('fakeTemplate');
      stream.write('');
      process.nextTick(function() {
        // in the next process cycle, end the stream
        stream.end();
      });

      return stream.pipe(vinylBuffer()); 
    },

    exists = function (fileGlobs) {
      var
        options = { nonull : false },
        fileNames = globby.sync(fileGlobs, options);

      return fileNames && fileNames.length > 0;
    },

    run = function (src, name) {
      var stream;

      if (exists(src)) {
        stream = gulp.src(src);
      }
      else {
        stream = emptyStream(); 
      }

      return stream 
        //.pipe(minifyHtml({
            //empty  : true,
            //spare  : true,
            //quotes : true
        //}))
        .pipe(ngHtml2Js({
          moduleName : name 
        }))
        .pipe(concat(name + '.js'))
        .pipe(gulp.dest(config.build_dir));
    },

    app = run(config.app_files.atpl, templatesApp),
    common = run(config.app_files.ctpl, templatesCommon);

  return merge([app, common]);
}

// run jshint 
//
function lint() {
  var
    options = {
      lookup : true,  // use local .jshint file
    },

    globs = [].concat(
      'gulpfile.js',
      config.app_files.js,
      config.app_files.jsunit
    );

  return gulp.src(globs)
    .pipe(cached('linting'))
    .pipe(jshint(options))
    .pipe(jshint.reporter(stylish))
    .pipe(jshint.reporter('fail'));
}

var packFilename = pkg.name + '-' + pkg.version;

// compile our app less files into a single css file
//
function lessDev() {
  return gulp.src(config.app_files.less)
    .pipe(sourcemaps.init())
    .pipe(_less())
    .pipe(rename({
      basename: packFilename
    }))
    .pipe(sourcemaps.write())
    .pipe(gulp.dest(config.build_dir + '/assets'));
}

// compile our app less files into a single css file
// with minification
//
function lessProd() {
  return gulp.src(config.app_files.less)
    //.pipe(sourcemaps.init())
    .pipe(_less({
      plugins: [cleancss]
    }))
    .pipe(rename({
      basename: packFilename
    }))
    // TODO: cleancss plugin breaks source maps ...
    // https://github.com/less/less-plugin-clean-css/issues/7 
    //.pipe(sourcemaps.write())
    .pipe(gulp.dest(config.build_dir + '/assets'));
}

// concatenates all application source code and all specified vendor
// source code into a single file, minify and add banner
// and put it in the compile dir
//
function concatJs() {
  var files = [].concat(
    config.vendor_files.js,
    'module.prefix',
    config.build_dir + '/src/**/*.js',
    config.build_dir + '/' + templatesApp + '.js',
    config.build_dir + '/' + templatesCommon + '.js',
    'module.suffix');

  return gulp.src(files)
    .pipe(sourcemaps.init())
    .pipe(concat(packFilename + '.js'))
    .pipe(uglify())
    .pipe(header(banner, opt))
    .pipe(sourcemaps.write())
    .pipe(gulp.dest(config.compile_dir + '/assets/'));
}

// During development, we don't want concatenation, minification, etc.
// So to avoid these steps, we simply inject all script files directly
// into the index.html file.
// injects css and js files into our index.html file and output it
// to the build dir
// 
function indexDev() {
  var
    files  = [].concat(
      config.vendor_files.js,
      'src/**/*.js',
      templatesCommon + '.js',
      templatesApp + '.js',
      config.vendor_files.css,
      'assets/' + packFilename + '.css'
    ),

    sources = gulp.src(files, { read : false, cwd: config.build_dir });

  return gulp.src('src/index-gulp.html') // TODO: change to use config.app_files.html  
    .pipe(inject(sources, { addRootSlash: false }))
    .pipe(gulp.dest(config.build_dir));
}

// For production include only a single JavaScript and a single CSS
// injects css and js file into our index.html file and output it
// to the build dir
//
function indexProd() {
  var
    files  = [].concat(
      'assets/' + packFilename + '.js',
      config.vendor_files.css,
      'assets/' + packFilename + '.css'
    ),

    sources = gulp.src(files, { read : false, cwd: config.compile_dir });

  return gulp.src('src/index-gulp.html') // TODO: change to use config.app_files.html 
    .pipe(inject(sources, { addRootSlash: false }))
    .pipe(gulp.dest(config.compile_dir));
}

// Generate the karma config file from the karma config template
//
function karmaConfig() {
  var files = [].concat(
      config.vendor_files.js,
      config.build_dir + '/' + templatesCommon + '.js',
      config.build_dir + '/' + templatesApp + '.js',
      config.test_files.js,
      'src/**/*.js'
    );

  return gulp.src('karma/karma-unit.gulp.tpl.js')
    .pipe(inject(gulp.src(files, {read: false}), {
      starttag: 'files: [',
      endtag: ']',
      transform: function (filepath, file, i, length) {
        return '  "' + filepath + '"' + (i + 1 < length ? ',' : '');
      },
      addRootSlash: false
    }))
    .pipe(rename({
      basename: 'karma-unit'
    }))
    .pipe(gulp.dest(config.build_dir));
}

// run unit tests
// these run on the src files in their original directory 
// not in the build directory
// (run karma once and exit)
function karmaSingle(done) {
  karma.start({
    configFile : __dirname + '/' + config.build_dir + '/karma-unit.js',
    singleRun  : true
  }, done);
}

// Setup livereload to watch our build directory for changes, and reload.
//
function livereload(done) {
    _livereload.listen();
    gulp.watch(config.build_dir + '/**').on('change', _livereload.changed);
    done();
}

// the watches
function delta(done) {
  // when the gulpfile changes we want to lint it and reload it
  // TODO: auto reload the gulp file???
  gulp.watch('gulpfile.js', gulp.series(lint));

  // when the js source files change, we want to lint them and run
  // the unit tests
  gulp.watch(config.app_files.js, gulp.series(lint, karmaSingle, copy));

  // When a JavaScript unit test file changes, we only want to lint it and
  // run the unit tests.
  gulp.watch(config.app_files.jsunit, gulp.series(lint, karmaSingle));

  // when assets are changed, copy them
  // this will copy new files, but wont remove deleted files
  gulp.watch('src/assets/**/*', gulp.series(copy)); 

  // when the index.html changes, we need to compile it
  gulp.watch('src/index-gulp.html', gulp.series(indexDev)); // TODO: change to use config.app_files.html 

  // when our templates change, we only rewrite the template cache
  gulp.watch([config.app_files.atpl, config.app_files.ctpl], gulp.series(html2js));

  // when the less files change, we need to compile and minify them.
  gulp.watch('src/**/*.less', gulp.series(lessDev));

  done();
}

// performs a development build 
//
gulp.task('build', gulp.series(
  clean, lint, lessDev,
  gulp.parallel(html2js, copy),
  gulp.parallel(indexDev, karmaConfig),
  karmaSingle
));

gulp.task('clean', gulp.series(clean));

// watch for file changes and perform incremental builds
//
gulp.task('watch', gulp.series('build', delta, livereload));

// The `compile` task gets your app ready for deployment by concatenating and
// minifying your code.
//
gulp.task('compile', gulp.series(lessProd, copyCompileAssets, ngAnnotate, concatJs, indexProd));
