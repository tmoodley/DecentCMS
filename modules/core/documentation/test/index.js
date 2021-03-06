// DecentCMS (c) 2015 Bertrand Le Roy, under MIT. See LICENSE.txt for licensing details.
'use strict';
var expect = require('chai').expect;
var proxyquire = require('proxyquire');
var path = require('path');
var DocumentationPathMapper = require('../services/documentation-path-mapper');
var ApiDocumentationPathMapper = require('../services/api-documentation-path-mapper');

// Define a fake file system's hierarchy.
var fileSystem = {
  name: '',
  items: [
    {name: 'docs', items: [
      {name: 'index.json'},
      {name: 'some-top-level-topic.yaml.md'}
    ]},
    {name: 'modules', items: [
      {name: 'module1', items: [
        {name: 'docs', items: [
          {name: 'index.json'},
          {name: 'some-topic.yaml.md'}
        ]},
        {name: 'lib', items: [
          {name: 'library1.js'},
          {name: 'library2.js'}
        ]},
        {name: 'services', items: [
          {name: 'service1.js'},
          {name: 'service2.js'}
        ]}
      ]},
      {name: 'module2', items: [
        {name: 'docs', items: [
          {name: 'some-topic.yaml.md'}
        ]},
        {name: 'services', items: [
          {name: 'service1.js'},
          {name: 'service2.js'}
        ]}
      ]}
    ]}
  ]
};
var root = path.resolve('');
function resolve(dirPath) {
  if (dirPath.substr(0, root.length) === root) dirPath = dirPath.substr(root.length);
  if (dirPath[0] === path.sep) dirPath = dirPath.substr(1);
  var p = dirPath.split(path.sep);
  var dir = fileSystem;
  for (var i = 0; i < p.length; i++) {
    var sub = p[i];
    if (!dir.items) return null;
    for (var j = 0; j < dir.items.length; j++) {
      if (dir.items[j].name === sub) {
        dir = dir.items[j];
        break;
      }
    }
  }
  return dir;
}
var stubs = {
  fs: {
    existsSync: function(fileOrFolderPath) {
      return !!resolve(fileOrFolderPath);
    },
    readdirSync: function(dirPath) {
      var dir = resolve(dirPath);
      return dir.items.map(function(item) {return item.name;});
    },
    statSync: function(fileOrFolderPath) {
      var fileOrFolder = resolve(fileOrFolderPath);
      return fileOrFolder.items
        ? {isDirectory: function() {return true;}, isFile: function() {return false;}}
        : {isDirectory: function() {return false;}, isFile: function() {return true;}};
    },
    mkdirSync: function() {},
    writeFile: function(path, data, done) {done();},
    '@noCallThru': true
  }
};

var itemsToIndex = [
  {id: 'docs:top1', title: 'Top 1'},
  {id: 'foo:bar'},
  {id: 'docs:', title: 'Root'},
  {id: 'docs:module1/topic2', title: 'Module 1 topic 2'},
  {id: 'docs:top2', title: 'Top 2'},
  {id: 'docs:module1', title: 'Module 1 index'},
  {id: 'apidocs:module1/service1', title: 'Module 1 service 1'},
  {id: 'docs:module1/topic1', title: 'Module 1 topic 1'},
  {id: 'docs:module2', title: 'Module 2 index'}
];

var scope = {
  require: function(service) {
    switch(service) {
      case 'shell':
        return {
          moduleManifests: {
            module1: {physicalPath: path.resolve('modules', 'module1')},
            module2: {physicalPath: path.resolve('modules', 'module2')}
          }
        };
      case 'log':
        return {
          info: function() {}
        };
      case 'content-manager':
        return {
          getParts: function() {
            return ['toc'];
          }
        };
      case 'url-helper':
        return {
          getUrl: function(id) {return 'url:' + id;}
        };
      case 'index':
        return {
          getIndex: function(context) {
            var index = [];
            itemsToIndex.forEach(function(item) {
              if (!context.idFilter.test(item.id)) return;
              var entry = context.map(item);
              entry.itemId = item.id;
              index.push(entry);
            });
            index.sort(function compare(a, b) {
              a = context.orderBy(a);
              b = context.orderBy(b);
              for (var i = 0; i < a.length && i < b.length; i++) {
                var ai = a[i], bi = b[i];
                if ((!ai && bi) || ai < bi) return -1;
                if ((!bi && ai) || bi < ai) return 1;
              }
              return a.length - b.length;
            });
            return {
              reduce: function(fun, seed, done) {
                index.forEach(function(entry) {
                  seed = fun(seed, entry);
                });
                done(seed);
              }
            };
          }
        };
      default:
        return null;
    }
  },
  getServices: function(service) {
    return [{extensions: ['.json', '.yaml.md']}];
  },
  callService: function(service, method, context, callback) {
    Object.getOwnPropertyNames(context.itemsToFetch).forEach(function(itemId) {
      context.items = context.items || {};
      context.items[itemId] = {id: itemId};
      delete context.itemsToFetch[itemId];
    });
    callback();
  }
};

describe('Documentation path mapper', function() {
  var scope = {
    require: function() {return {
      moduleManifests: {
        module: {
          physicalPath: 'path/to/module'
        }
      }
    };}
  };

  it("won't map paths outside of /docs", function() {
    var mapper = new DocumentationPathMapper({});
    var paths = mapper.mapIdToPath('not-doc', '/path/to/foo');

    expect(paths).to.not.be.ok;
  });

  it('maps /docs to /docs/index paths', function() {
    var mapper = new DocumentationPathMapper(scope);
    var paths = mapper.mapIdToPath('docs', '');

    expect(paths).to.deep.equal([
      path.resolve('docs/index.json'),
      path.resolve('docs/index.yaml'),
      path.resolve('docs/index.yaml.md')
    ])
  });

  it('maps /docs/module to /path/to/module/docs/index paths', function() {
    var mapper = new DocumentationPathMapper(scope);
    var paths = mapper.mapIdToPath('docs', 'module');

    expect(paths).to.deep.equal([
      path.resolve('path/to/module/docs/index.json'),
      path.resolve('path/to/module/docs/index.yaml'),
      path.resolve('path/to/module/docs/index.yaml.md')
    ])
  });

  it('maps /docs/topic to /docs/topic paths', function() {
    var mapper = new DocumentationPathMapper(scope);
    var paths = mapper.mapIdToPath('docs', 'topic');

    expect(paths).to.deep.equal([
      path.resolve('docs/topic.json'),
      path.resolve('docs/topic.yaml'),
      path.resolve('docs/topic.yaml.md')
    ])
  });

  it('maps /docs/module/topic to /path/to/module/docs/topic paths', function() {
    var mapper = new DocumentationPathMapper(scope);
    var paths = mapper.mapIdToPath('docs', 'module/topic');

    expect(paths).to.deep.equal([
      path.resolve('path/to/module/docs/topic.json'),
      path.resolve('path/to/module/docs/topic.yaml'),
      path.resolve('path/to/module/docs/topic.yaml.md')
    ])
  });
});

describe('Documentation Route Handler', function() {
  var DocumentationRouteHandler = require('../services/documentation-route-handler');
  it('promises to render topics with the main display type', function(done) {
    var middleware = null;
    var context = {
      expressApp: {
        register: function(priority, registration) {
          middleware = registration;
        }
      }
    };
    var shape = null;
    var contentRenderer = {
      promiseToRender: function(s) {
        shape = s;
      }
    };
    DocumentationRouteHandler.register({}, context);
    var handler = null;
    var route = null;
    var app = {
      get: function(r, h) {
        route = r;
        handler = h;
      }
    };
    middleware(app);

    expect(route).to.equal('/docs(/*)?');

    handler({
      require: function() {
        return contentRenderer;
      },
      contentManager: contentRenderer,
      path: '/docs/module/topic'
    }, null, function() {
      expect(shape.id).to.equal('docs:module/topic');
      expect(shape.displayType).to.equal('main');
      done();
    });
  });

  it("can build a topic's URL from its id", function() {
    expect(DocumentationRouteHandler.getUrl('docs:foo/bar'))
      .to.equal('/docs/foo/bar');
    expect(DocumentationRouteHandler.getUrl('foo/bar/baz'))
      .to.not.be.ok;
    expect(DocumentationRouteHandler.getUrl('foo:bar/baz'))
      .to.not.be.ok;
  });
});

describe('API Documentation path mapper', function() {
  var scope = {
    require: function() {return {
      moduleManifests: {
        module: {
          physicalPath: 'path/to/module'
        }
      }
    };}
  };

  it("won't map paths outside of /docs/api", function() {
    var mapper = new ApiDocumentationPathMapper({});
    var paths = mapper.mapIdToPath('not-apidocs', '/path/to/foo');

    expect(paths).to.not.be.ok;
  });

  it('maps /docs/api/module/service to path/to/module/lib/service.js and path/to/module/services/service.js paths', function() {
    var mapper = new ApiDocumentationPathMapper(scope);
    var paths = mapper.mapIdToPath('apidocs', 'module/service');

    expect(paths).to.deep.equal([
      path.resolve('path/to/module/services/service.js'),
      path.resolve('path/to/module/lib/service.js')
    ])
  });
});

describe('API Documentation Route Handler', function() {
  var ApiDocumentationRouteHandler = require('../services/api-documentation-route-handler');
  it('promises to render topics with the main display type', function(done) {
    var middleware = null;
    var context = {
      expressApp: {
        register: function(priority, registration) {
          middleware = registration;
        }
      }
    };
    var shape = null;
    var contentRenderer = {
      promiseToRender: function(s) {
        shape = s;
      }
    };
    ApiDocumentationRouteHandler.register({}, context);
    var handler = null;
    var route = null;
    var app = {
      get: function(r, h) {
        route = r;
        handler = h;
      }
    };
    middleware(app);

    expect(route).to.equal('/docs/api(/*)?');

    handler({
      require: function() {
        return contentRenderer;
      },
      contentManager: contentRenderer,
      path: '/docs/api/module/service'
    }, null, function() {
      expect(shape.id).to.equal('apidocs:module/service');
      expect(shape.displayType).to.equal('main');
      done();
    });
  });

  it("can build an API topic's URL from its id", function() {
    expect(ApiDocumentationRouteHandler.getUrl('apidocs:foo/bar'))
      .to.equal('/docs/api/foo/bar');
    expect(ApiDocumentationRouteHandler.getUrl('foo/bar/baz'))
      .to.not.be.ok;
    expect(ApiDocumentationRouteHandler.getUrl('foo:bar/baz'))
      .to.not.be.ok;
  });
});

describe('JsDoc File Parser', function() {
  var js = '// A js file\r\n\r\n' +
    '/**\r\n' +
    'A function\r\n' +
    '*/\r\n' +
    'function foo() {};\r\n';
  var parser = proxyquire('../services/jsdoc-content-file-parser', {
    'path/to/some-file-to-test.js': {
      scope: 'shell',
      feature: 'some feature',
      service: 'some service',
      '@noCallThru': true
    },
    fs: stubs.fs
  });

  it('parses JavaScript files for JsDoc', function(done) {
    this.timeout(5000);
    var context = {
      path: 'path/to/some-file-to-test.js',
      data: js,
      scope: {
        require: function() {
          return {
            transform: function(fileName) {
              return fileName.replace(/-/g, ' ');
            }
          }
        }
      }
    };
    parser.parse(context, function() {
      expect(context.item.meta.type).to.equal('api-documentation');
      expect(context.item.title).to.equal('path/to/some file to test.js');
      expect(context.item.scope).to.equal('shell');
      expect(context.item.feature).to.equal('some feature');
      expect(context.item.service).to.equal('some service');
      expect(context.item.body.flavor).to.equal('markdown');
      expect(context.item.body.text).to.equal('<a name=\"foo\"></a>\n## foo()\nA function\n\n');
      done();
    });
  });

  it("won't parse other types of files", function(done) {
    var context = {
      path: 'path/to/some-file-to-test.unknown',
      data: 'foo'
    };
    parser.parse(context, function() {
      expect(context.item).to.not.be.ok;
      done();
    });
  });
});

describe('Documentation Enumerator', function() {
  var documentationEnumerator = proxyquire('../services/documentation-enumerator', stubs);

  it('enumerates all topics in the system', function(done) {
    var items = {};
    var iterate = documentationEnumerator.getItemEnumerator({scope: scope});
    var iterator = function(err, item) {
      if (err) throw err;
      if (item) {
        items[item.id] = item;
        iterate(iterator);
      }
      else {
        expect(items).to.deep.equal({
          "docs:": {id: "docs:"},
          "docs:some-top-level-topic": {id: "docs:some-top-level-topic"},
          "docs:module1": {id: "docs:module1"},
          "docs:module1/some-topic": {id: "docs:module1/some-topic"},
          "docs:module2/some-topic": {id: "docs:module2/some-topic"}
        });
        done();
      }
    };
    iterate(iterator);
  });

  it('can filter by id', function(done) {
    var items = {};
    var iterate = documentationEnumerator.getItemEnumerator({
      scope: scope,
      idFilter: /^docs:module1.*$/
    });
    var iterator = function(err, item) {
      if (err) throw err;
      if (item) {
        items[item.id] = item;
        iterate(iterator);
      }
      else {
        expect(items).to.deep.equal({
          "docs:module1": {id: "docs:module1"},
          "docs:module1/some-topic": {id: "docs:module1/some-topic"},
        });
        done();
      }
    };
    iterate(iterator);
  });
});

describe('API Documentation Enumerator', function() {
  var apiDocumentationEnumerator = proxyquire('../services/api-documentation-enumerator', stubs);

  it('enumerates all libraries and services in the system', function(done) {
    var items = {};
    var iterate = apiDocumentationEnumerator.getItemEnumerator({scope: scope});
    var iterator = function(err, item) {
      if (err) throw err;
      if (item) {
        items[item.id] = item;
        iterate(iterator);
      }
      else {
        expect(items).to.deep.equal({
          "apidocs:module1/library1": {id: "apidocs:module1/library1"},
          "apidocs:module1/library2": {id: "apidocs:module1/library2"},
          "apidocs:module1/service1": {id: "apidocs:module1/service1"},
          "apidocs:module1/service2": {id: "apidocs:module1/service2"},
          "apidocs:module2/service1": {id: "apidocs:module2/service1"},
          "apidocs:module2/service2": {id: "apidocs:module2/service2"}
        });
        done();
      }
    };
    iterate(iterator);
  });

  it('can filter by id', function(done) {
    var items = {};
    var iterate = apiDocumentationEnumerator.getItemEnumerator({
      scope: scope,
      idFilter: /^apidocs:.*\/service1$/
    });
    var iterator = function(err, item) {
      if (err) throw err;
      if (item) {
        items[item.id] = item;
        iterate(iterator);
      }
      else {
        expect(items).to.deep.equal({
          "apidocs:module1/service1": {id: "apidocs:module1/service1"},
          "apidocs:module2/service1": {id: "apidocs:module2/service1"}
        });
        done();
      }
    };
    iterate(iterator);
  });
});

describe('Documentation TOC part', function() {
  var tocPart = require('../services/documentation-toc-part');

  it('creates top-level and local tables of contents, as well as breadcrumbs and previous/current/next', function(done) {
    var tocItem = {
      meta: {type: 'content'},
      temp: {shapes: []},
      toc: {}
    };
    tocItem.temp.item = tocItem;
    scope.itemId = 'apidocs:module1/service1';
    tocPart.handle({
      scope: scope,
      shape: tocItem
    }, function() {
      expect(tocItem.toc.topLevelTOC).to.deep.equal([
        {itemId: 'docs:', module: null, section: null, name: '', number: '9000', title: 'Root', url: 'url:docs:'},
        {itemId: 'docs:top1', module: null, section: null, name: 'top1', number: '9000', title: 'Top 1', url: 'url:docs:top1'},
        {itemId: 'docs:top2', module: null, section: null, name: 'top2', number: '9000', title: 'Top 2', url: 'url:docs:top2'},
        {itemId: 'docs:module1', isModuleIndex: true, module: 'module1', section: null, name: 'index', number: '0', title: 'Module 1 index', url: 'url:docs:module1'},
        {itemId: 'docs:module2', isModuleIndex: true, module: 'module2', section: null, name: 'index', number: '0', title: 'Module 2 index', url: 'url:docs:module2'}
      ]);
      expect(tocItem.toc.localTOC).to.deep.equal([
        {itemId: 'docs:module1/topic1', module: 'module1', section: null, name: 'topic1', number: '9000', title: 'Module 1 topic 1', url: 'url:docs:module1/topic1'},
        {itemId: 'docs:module1/topic2', module: 'module1', section: null, name: 'topic2', number: '9000', title: 'Module 1 topic 2', url: 'url:docs:module1/topic2'},
        {itemId: 'apidocs:module1/service1', module: 'module1', section: null, name: 'service1', number: '9000', title: 'Module 1 service 1', url: 'url:apidocs:module1/service1'}
      ]);
      expect(tocItem.toc.breadcrumbs).to.deep.equal([
        {itemId: 'docs:module1', isModuleIndex: true, module: 'module1', section: null, name: 'index', number: '0', title: 'Module 1 index', url: 'url:docs:module1'},
        {itemId: 'apidocs:module1/service1', module: 'module1', section: null, name: 'service1', number: '9000', title: 'Module 1 service 1', url: 'url:apidocs:module1/service1'}
      ]);
      expect(tocItem.toc.previous).to.deep.equal(
        {itemId: 'docs:module1/topic2', module: 'module1', section: null, name: 'topic2', number: '9000', title: 'Module 1 topic 2', url: 'url:docs:module1/topic2'}
      );
      expect(tocItem.toc.current).to.deep.equal(
        {itemId: 'apidocs:module1/service1', module: 'module1', section: null, name: 'service1', number: '9000', title: 'Module 1 service 1', url: 'url:apidocs:module1/service1'}
      );
      expect(tocItem.toc.next).to.deep.equal(
        {itemId: 'docs:module2', isModuleIndex: true, module: 'module2', section: null, name: 'index', number: '0', title: 'Module 2 index', url: 'url:docs:module2'}
      );
      done();
    });
  });
});