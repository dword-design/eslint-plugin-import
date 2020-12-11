'use strict';





var _ExportMap = require('../ExportMap');var _ExportMap2 = _interopRequireDefault(_ExportMap);
var _ignore = require('eslint-module-utils/ignore');
var _resolve = require('eslint-module-utils/resolve');var _resolve2 = _interopRequireDefault(_resolve);
var _docsUrl = require('../docsUrl');var _docsUrl2 = _interopRequireDefault(_docsUrl);
var _path = require('path');
var _readPkgUp = require('read-pkg-up');var _readPkgUp2 = _interopRequireDefault(_readPkgUp);
var _object = require('object.values');var _object2 = _interopRequireDefault(_object);
var _arrayIncludes = require('array-includes');var _arrayIncludes2 = _interopRequireDefault(_arrayIncludes);function _interopRequireDefault(obj) {return obj && obj.__esModule ? obj : { default: obj };}function _toConsumableArray(arr) {if (Array.isArray(arr)) {for (var i = 0, arr2 = Array(arr.length); i < arr.length; i++) arr2[i] = arr[i];return arr2;} else {return Array.from(arr);}} /**
                                                                                                                                                                                                                                                                                                                                                                                                   * @fileOverview Ensures that modules contain exports and/or all
                                                                                                                                                                                                                                                                                                                                                                                                   * modules are consumed within other modules.
                                                                                                                                                                                                                                                                                                                                                                                                   * @author René Fermann
                                                                                                                                                                                                                                                                                                                                                                                                   */ // eslint/lib/util/glob-util has been moved to eslint/lib/util/glob-utils with version 5.3
// and has been moved to eslint/lib/cli-engine/file-enumerator in version 6
let listFilesToProcess;try {const FileEnumerator = require('eslint/lib/cli-engine/file-enumerator').FileEnumerator;
  listFilesToProcess = function (src, extensions) {
    const e = new FileEnumerator({
      extensions: extensions });

    return Array.from(e.iterateFiles(src), (_ref) => {let filePath = _ref.filePath,ignored = _ref.ignored;return {
        ignored,
        filename: filePath };});

  };
} catch (e1) {
  // Prevent passing invalid options (extensions array) to old versions of the function.
  // https://github.com/eslint/eslint/blob/v5.16.0/lib/util/glob-utils.js#L178-L280
  // https://github.com/eslint/eslint/blob/v5.2.0/lib/util/glob-util.js#L174-L269
  let originalListFilesToProcess;
  try {
    originalListFilesToProcess = require('eslint/lib/util/glob-utils').listFilesToProcess;
    listFilesToProcess = function (src, extensions) {
      return originalListFilesToProcess(src, {
        extensions: extensions });

    };
  } catch (e2) {
    originalListFilesToProcess = require('eslint/lib/util/glob-util').listFilesToProcess;

    listFilesToProcess = function (src, extensions) {
      const patterns = src.reduce((carry, pattern) => {
        return carry.concat(extensions.map(extension => {
          return (/\*\*|\*\./.test(pattern) ? pattern : `${pattern}/**/*${extension}`);
        }));
      }, src.slice());

      return originalListFilesToProcess(patterns);
    };
  }
}

const EXPORT_DEFAULT_DECLARATION = 'ExportDefaultDeclaration';
const EXPORT_NAMED_DECLARATION = 'ExportNamedDeclaration';
const EXPORT_ALL_DECLARATION = 'ExportAllDeclaration';
const IMPORT_DECLARATION = 'ImportDeclaration';
const IMPORT_NAMESPACE_SPECIFIER = 'ImportNamespaceSpecifier';
const IMPORT_DEFAULT_SPECIFIER = 'ImportDefaultSpecifier';
const VARIABLE_DECLARATION = 'VariableDeclaration';
const FUNCTION_DECLARATION = 'FunctionDeclaration';
const CLASS_DECLARATION = 'ClassDeclaration';
const TS_INTERFACE_DECLARATION = 'TSInterfaceDeclaration';
const TS_TYPE_ALIAS_DECLARATION = 'TSTypeAliasDeclaration';
const TS_ENUM_DECLARATION = 'TSEnumDeclaration';
const DEFAULT = 'default';

function forEachDeclarationIdentifier(declaration, cb) {
  if (declaration) {
    if (
    declaration.type === FUNCTION_DECLARATION ||
    declaration.type === CLASS_DECLARATION ||
    declaration.type === TS_INTERFACE_DECLARATION ||
    declaration.type === TS_TYPE_ALIAS_DECLARATION ||
    declaration.type === TS_ENUM_DECLARATION)
    {
      cb(declaration.id.name);
    } else if (declaration.type === VARIABLE_DECLARATION) {
      declaration.declarations.forEach((_ref2) => {let id = _ref2.id;
        cb(id.name);
      });
    }
  }
}

/**
   * List of imports per file.
   *
   * Represented by a two-level Map to a Set of identifiers. The upper-level Map
   * keys are the paths to the modules containing the imports, while the
   * lower-level Map keys are the paths to the files which are being imported
   * from. Lastly, the Set of identifiers contains either names being imported
   * or a special AST node name listed above (e.g ImportDefaultSpecifier).
   *
   * For example, if we have a file named foo.js containing:
   *
   *   import { o2 } from './bar.js';
   *
   * Then we will have a structure that looks like:
   *
   *   Map { 'foo.js' => Map { 'bar.js' => Set { 'o2' } } }
   *
   * @type {Map<string, Map<string, Set<string>>>}
   */
const importList = new Map();

/**
                               * List of exports per file.
                               *
                               * Represented by a two-level Map to an object of metadata. The upper-level Map
                               * keys are the paths to the modules containing the exports, while the
                               * lower-level Map keys are the specific identifiers or special AST node names
                               * being exported. The leaf-level metadata object at the moment only contains a
                               * `whereUsed` propoerty, which contains a Set of paths to modules that import
                               * the name.
                               *
                               * For example, if we have a file named bar.js containing the following exports:
                               *
                               *   const o2 = 'bar';
                               *   export { o2 };
                               *
                               * And a file named foo.js containing the following import:
                               *
                               *   import { o2 } from './bar.js';
                               *
                               * Then we will have a structure that looks like:
                               *
                               *   Map { 'bar.js' => Map { 'o2' => { whereUsed: Set { 'foo.js' } } } }
                               *
                               * @type {Map<string, Map<string, object>>}
                               */
const exportList = new Map();

const ignoredFiles = new Set();
const filesOutsideSrc = new Set();

const isNodeModule = path => {
  return (/\/(node_modules)\//.test(path));
};

/**
    * read all files matching the patterns in src and ignoreExports
    *
    * return all files matching src pattern, which are not matching the ignoreExports pattern
    */
const resolveFiles = (src, ignoreExports, context) => {
  const extensions = Array.from((0, _ignore.getFileExtensions)(context.settings));

  const srcFiles = new Set();
  const srcFileList = listFilesToProcess(src, extensions);

  // prepare list of ignored files
  const ignoredFilesList = listFilesToProcess(ignoreExports, extensions);
  ignoredFilesList.forEach((_ref3) => {let filename = _ref3.filename;return ignoredFiles.add(filename);});

  // prepare list of source files, don't consider files from node_modules
  srcFileList.filter((_ref4) => {let filename = _ref4.filename;return !isNodeModule(filename);}).forEach((_ref5) => {let filename = _ref5.filename;
    srcFiles.add(filename);
  });
  return srcFiles;
};

/**
    * parse all source files and build up 2 maps containing the existing imports and exports
    */
const prepareImportsAndExports = (srcFiles, context) => {
  const exportAll = new Map();
  srcFiles.forEach(file => {
    const exports = new Map();
    const imports = new Map();
    const currentExports = _ExportMap2.default.get(file, context);
    if (currentExports) {const
      dependencies = currentExports.dependencies,reexports = currentExports.reexports,localImportList = currentExports.imports,namespace = currentExports.namespace;

      // dependencies === export * from
      const currentExportAll = new Set();
      dependencies.forEach(getDependency => {
        const dependency = getDependency();
        if (dependency === null) {
          return;
        }

        currentExportAll.add(dependency.path);
      });
      exportAll.set(file, currentExportAll);

      reexports.forEach((value, key) => {
        if (key === DEFAULT) {
          exports.set(IMPORT_DEFAULT_SPECIFIER, { whereUsed: new Set() });
        } else {
          exports.set(key, { whereUsed: new Set() });
        }
        const reexport = value.getImport();
        if (!reexport) {
          return;
        }
        let localImport = imports.get(reexport.path);
        let currentValue;
        if (value.local === DEFAULT) {
          currentValue = IMPORT_DEFAULT_SPECIFIER;
        } else {
          currentValue = value.local;
        }
        if (typeof localImport !== 'undefined') {
          localImport = new Set([].concat(_toConsumableArray(localImport), [currentValue]));
        } else {
          localImport = new Set([currentValue]);
        }
        imports.set(reexport.path, localImport);
      });

      localImportList.forEach((value, key) => {
        if (isNodeModule(key)) {
          return;
        }
        let localImport = imports.get(key);
        if (typeof localImport !== 'undefined') {
          localImport = new Set([].concat(_toConsumableArray(localImport), _toConsumableArray(value.importedSpecifiers)));
        } else {
          localImport = value.importedSpecifiers;
        }
        imports.set(key, localImport);
      });
      importList.set(file, imports);

      // build up export list only, if file is not ignored
      if (ignoredFiles.has(file)) {
        return;
      }
      namespace.forEach((value, key) => {
        if (key === DEFAULT) {
          exports.set(IMPORT_DEFAULT_SPECIFIER, { whereUsed: new Set() });
        } else {
          exports.set(key, { whereUsed: new Set() });
        }
      });
    }
    exports.set(EXPORT_ALL_DECLARATION, { whereUsed: new Set() });
    exports.set(IMPORT_NAMESPACE_SPECIFIER, { whereUsed: new Set() });
    exportList.set(file, exports);
  });
  exportAll.forEach((value, key) => {
    value.forEach(val => {
      const currentExports = exportList.get(val);
      const currentExport = currentExports.get(EXPORT_ALL_DECLARATION);
      currentExport.whereUsed.add(key);
    });
  });
};

/**
    * traverse through all imports and add the respective path to the whereUsed-list
    * of the corresponding export
    */
const determineUsage = () => {
  importList.forEach((listValue, listKey) => {
    listValue.forEach((value, key) => {
      const exports = exportList.get(key);
      if (typeof exports !== 'undefined') {
        value.forEach(currentImport => {
          let specifier;
          if (currentImport === IMPORT_NAMESPACE_SPECIFIER) {
            specifier = IMPORT_NAMESPACE_SPECIFIER;
          } else if (currentImport === IMPORT_DEFAULT_SPECIFIER) {
            specifier = IMPORT_DEFAULT_SPECIFIER;
          } else {
            specifier = currentImport;
          }
          if (typeof specifier !== 'undefined') {
            const exportStatement = exports.get(specifier);
            if (typeof exportStatement !== 'undefined') {const
              whereUsed = exportStatement.whereUsed;
              whereUsed.add(listKey);
              exports.set(specifier, { whereUsed });
            }
          }
        });
      }
    });
  });
};

const getSrc = src => {
  if (src) {
    return src;
  }
  return [process.cwd()];
};

/**
    * prepare the lists of existing imports and exports - should only be executed once at
    * the start of a new eslint run
    */
let srcFiles;
let lastPrepareKey;
const doPreparation = (src, ignoreExports, context) => {
  const prepareKey = JSON.stringify({
    src: (src || []).sort(),
    ignoreExports: (ignoreExports || []).sort(),
    extensions: Array.from((0, _ignore.getFileExtensions)(context.settings)).sort() });

  if (prepareKey === lastPrepareKey) {
    return;
  }

  importList.clear();
  exportList.clear();
  ignoredFiles.clear();
  filesOutsideSrc.clear();

  srcFiles = resolveFiles(getSrc(src), ignoreExports, context);
  prepareImportsAndExports(srcFiles, context);
  determineUsage();
  lastPrepareKey = prepareKey;
};

const newNamespaceImportExists = specifiers =>
specifiers.some((_ref6) => {let type = _ref6.type;return type === IMPORT_NAMESPACE_SPECIFIER;});

const newDefaultImportExists = specifiers =>
specifiers.some((_ref7) => {let type = _ref7.type;return type === IMPORT_DEFAULT_SPECIFIER;});

const fileIsInPkg = file => {var _readPkgUp$sync =
  _readPkgUp2.default.sync({ cwd: file, normalize: false });const path = _readPkgUp$sync.path,pkg = _readPkgUp$sync.pkg;
  const basePath = (0, _path.dirname)(path);

  const checkPkgFieldString = pkgField => {
    if ((0, _path.join)(basePath, pkgField) === file) {
      return true;
    }
  };

  const checkPkgFieldObject = pkgField => {
    const pkgFieldFiles = (0, _object2.default)(pkgField).map(value => (0, _path.join)(basePath, value));
    if ((0, _arrayIncludes2.default)(pkgFieldFiles, file)) {
      return true;
    }
  };

  const checkPkgField = pkgField => {
    if (typeof pkgField === 'string') {
      return checkPkgFieldString(pkgField);
    }

    if (typeof pkgField === 'object') {
      return checkPkgFieldObject(pkgField);
    }
  };

  if (pkg.private === true) {
    return false;
  }

  if (pkg.bin) {
    if (checkPkgField(pkg.bin)) {
      return true;
    }
  }

  if (pkg.browser) {
    if (checkPkgField(pkg.browser)) {
      return true;
    }
  }

  if (pkg.main) {
    if (checkPkgFieldString(pkg.main)) {
      return true;
    }
  }

  return false;
};

module.exports = {
  meta: {
    type: 'suggestion',
    docs: { url: (0, _docsUrl2.default)('no-unused-modules') },
    schema: [{
      properties: {
        src: {
          description: 'files/paths to be analyzed (only for unused exports)',
          type: 'array',
          minItems: 1,
          items: {
            type: 'string',
            minLength: 1 } },


        ignoreExports: {
          description:
          'files/paths for which unused exports will not be reported (e.g module entry points)',
          type: 'array',
          minItems: 1,
          items: {
            type: 'string',
            minLength: 1 } },


        missingExports: {
          description: 'report modules without any exports',
          type: 'boolean' },

        unusedExports: {
          description: 'report exports without any usage',
          type: 'boolean' } },


      not: {
        properties: {
          unusedExports: { enum: [false] },
          missingExports: { enum: [false] } } },


      anyOf: [{
        not: {
          properties: {
            unusedExports: { enum: [true] } } },


        required: ['missingExports'] },
      {
        not: {
          properties: {
            missingExports: { enum: [true] } } },


        required: ['unusedExports'] },
      {
        properties: {
          unusedExports: { enum: [true] } },

        required: ['unusedExports'] },
      {
        properties: {
          missingExports: { enum: [true] } },

        required: ['missingExports'] }] }] },




  create: context => {var _ref8 =





    context.options[0] || {};const src = _ref8.src;var _ref8$ignoreExports = _ref8.ignoreExports;const ignoreExports = _ref8$ignoreExports === undefined ? [] : _ref8$ignoreExports,missingExports = _ref8.missingExports,unusedExports = _ref8.unusedExports;

    if (unusedExports) {
      doPreparation(src, ignoreExports, context);
    }

    const file = context.getFilename();

    const checkExportPresence = node => {
      if (!missingExports) {
        return;
      }

      if (ignoredFiles.has(file)) {
        return;
      }

      const exportCount = exportList.get(file);
      const exportAll = exportCount.get(EXPORT_ALL_DECLARATION);
      const namespaceImports = exportCount.get(IMPORT_NAMESPACE_SPECIFIER);

      exportCount.delete(EXPORT_ALL_DECLARATION);
      exportCount.delete(IMPORT_NAMESPACE_SPECIFIER);
      if (exportCount.size < 1) {
        // node.body[0] === 'undefined' only happens, if everything is commented out in the file
        // being linted
        context.report(node.body[0] ? node.body[0] : node, 'No exports found');
      }
      exportCount.set(EXPORT_ALL_DECLARATION, exportAll);
      exportCount.set(IMPORT_NAMESPACE_SPECIFIER, namespaceImports);
    };

    const checkUsage = (node, exportedValue) => {
      if (!unusedExports) {
        return;
      }

      if (ignoredFiles.has(file)) {
        return;
      }

      if (fileIsInPkg(file)) {
        return;
      }

      if (filesOutsideSrc.has(file)) {
        return;
      }

      // make sure file to be linted is included in source files
      if (!srcFiles.has(file)) {
        srcFiles = resolveFiles(getSrc(src), ignoreExports, context);
        if (!srcFiles.has(file)) {
          filesOutsideSrc.add(file);
          return;
        }
      }

      exports = exportList.get(file);

      // special case: export * from
      const exportAll = exports.get(EXPORT_ALL_DECLARATION);
      if (typeof exportAll !== 'undefined' && exportedValue !== IMPORT_DEFAULT_SPECIFIER) {
        if (exportAll.whereUsed.size > 0) {
          return;
        }
      }

      // special case: namespace import
      const namespaceImports = exports.get(IMPORT_NAMESPACE_SPECIFIER);
      if (typeof namespaceImports !== 'undefined') {
        if (namespaceImports.whereUsed.size > 0) {
          return;
        }
      }

      // exportsList will always map any imported value of 'default' to 'ImportDefaultSpecifier'
      const exportsKey = exportedValue === DEFAULT ? IMPORT_DEFAULT_SPECIFIER : exportedValue;

      const exportStatement = exports.get(exportsKey);

      const value = exportsKey === IMPORT_DEFAULT_SPECIFIER ? DEFAULT : exportsKey;

      if (typeof exportStatement !== 'undefined') {
        if (exportStatement.whereUsed.size < 1) {
          context.report(
          node,
          `exported declaration '${value}' not used within other modules`);

        }
      } else {
        context.report(
        node,
        `exported declaration '${value}' not used within other modules`);

      }
    };

    /**
        * only useful for tools like vscode-eslint
        *
        * update lists of existing exports during runtime
        */
    const updateExportUsage = node => {
      if (ignoredFiles.has(file)) {
        return;
      }

      let exports = exportList.get(file);

      // new module has been created during runtime
      // include it in further processing
      if (typeof exports === 'undefined') {
        exports = new Map();
      }

      const newExports = new Map();
      const newExportIdentifiers = new Set();

      node.body.forEach((_ref9) => {let type = _ref9.type,declaration = _ref9.declaration,specifiers = _ref9.specifiers;
        if (type === EXPORT_DEFAULT_DECLARATION) {
          newExportIdentifiers.add(IMPORT_DEFAULT_SPECIFIER);
        }
        if (type === EXPORT_NAMED_DECLARATION) {
          if (specifiers.length > 0) {
            specifiers.forEach(specifier => {
              if (specifier.exported) {
                newExportIdentifiers.add(specifier.exported.name);
              }
            });
          }
          forEachDeclarationIdentifier(declaration, name => {
            newExportIdentifiers.add(name);
          });
        }
      });

      // old exports exist within list of new exports identifiers: add to map of new exports
      exports.forEach((value, key) => {
        if (newExportIdentifiers.has(key)) {
          newExports.set(key, value);
        }
      });

      // new export identifiers added: add to map of new exports
      newExportIdentifiers.forEach(key => {
        if (!exports.has(key)) {
          newExports.set(key, { whereUsed: new Set() });
        }
      });

      // preserve information about namespace imports
      let exportAll = exports.get(EXPORT_ALL_DECLARATION);
      let namespaceImports = exports.get(IMPORT_NAMESPACE_SPECIFIER);

      if (typeof namespaceImports === 'undefined') {
        namespaceImports = { whereUsed: new Set() };
      }

      newExports.set(EXPORT_ALL_DECLARATION, exportAll);
      newExports.set(IMPORT_NAMESPACE_SPECIFIER, namespaceImports);
      exportList.set(file, newExports);
    };

    /**
        * only useful for tools like vscode-eslint
        *
        * update lists of existing imports during runtime
        */
    const updateImportUsage = node => {
      if (!unusedExports) {
        return;
      }

      let oldImportPaths = importList.get(file);
      if (typeof oldImportPaths === 'undefined') {
        oldImportPaths = new Map();
      }

      const oldNamespaceImports = new Set();
      const newNamespaceImports = new Set();

      const oldExportAll = new Set();
      const newExportAll = new Set();

      const oldDefaultImports = new Set();
      const newDefaultImports = new Set();

      const oldImports = new Map();
      const newImports = new Map();
      oldImportPaths.forEach((value, key) => {
        if (value.has(EXPORT_ALL_DECLARATION)) {
          oldExportAll.add(key);
        }
        if (value.has(IMPORT_NAMESPACE_SPECIFIER)) {
          oldNamespaceImports.add(key);
        }
        if (value.has(IMPORT_DEFAULT_SPECIFIER)) {
          oldDefaultImports.add(key);
        }
        value.forEach(val => {
          if (val !== IMPORT_NAMESPACE_SPECIFIER &&
          val !== IMPORT_DEFAULT_SPECIFIER) {
            oldImports.set(val, key);
          }
        });
      });

      node.body.forEach(astNode => {
        let resolvedPath;

        // support for export { value } from 'module'
        if (astNode.type === EXPORT_NAMED_DECLARATION) {
          if (astNode.source) {
            resolvedPath = (0, _resolve2.default)(astNode.source.raw.replace(/('|")/g, ''), context);
            astNode.specifiers.forEach(specifier => {
              const name = specifier.local.name;
              if (specifier.local.name === DEFAULT) {
                newDefaultImports.add(resolvedPath);
              } else {
                newImports.set(name, resolvedPath);
              }
            });
          }
        }

        if (astNode.type === EXPORT_ALL_DECLARATION) {
          resolvedPath = (0, _resolve2.default)(astNode.source.raw.replace(/('|")/g, ''), context);
          newExportAll.add(resolvedPath);
        }

        if (astNode.type === IMPORT_DECLARATION) {
          resolvedPath = (0, _resolve2.default)(astNode.source.raw.replace(/('|")/g, ''), context);
          if (!resolvedPath) {
            return;
          }

          if (isNodeModule(resolvedPath)) {
            return;
          }

          if (newNamespaceImportExists(astNode.specifiers)) {
            newNamespaceImports.add(resolvedPath);
          }

          if (newDefaultImportExists(astNode.specifiers)) {
            newDefaultImports.add(resolvedPath);
          }

          astNode.specifiers.forEach(specifier => {
            if (specifier.type === IMPORT_DEFAULT_SPECIFIER ||
            specifier.type === IMPORT_NAMESPACE_SPECIFIER) {
              return;
            }
            newImports.set(specifier.imported.name, resolvedPath);
          });
        }
      });

      newExportAll.forEach(value => {
        if (!oldExportAll.has(value)) {
          let imports = oldImportPaths.get(value);
          if (typeof imports === 'undefined') {
            imports = new Set();
          }
          imports.add(EXPORT_ALL_DECLARATION);
          oldImportPaths.set(value, imports);

          let exports = exportList.get(value);
          let currentExport;
          if (typeof exports !== 'undefined') {
            currentExport = exports.get(EXPORT_ALL_DECLARATION);
          } else {
            exports = new Map();
            exportList.set(value, exports);
          }

          if (typeof currentExport !== 'undefined') {
            currentExport.whereUsed.add(file);
          } else {
            const whereUsed = new Set();
            whereUsed.add(file);
            exports.set(EXPORT_ALL_DECLARATION, { whereUsed });
          }
        }
      });

      oldExportAll.forEach(value => {
        if (!newExportAll.has(value)) {
          const imports = oldImportPaths.get(value);
          imports.delete(EXPORT_ALL_DECLARATION);

          const exports = exportList.get(value);
          if (typeof exports !== 'undefined') {
            const currentExport = exports.get(EXPORT_ALL_DECLARATION);
            if (typeof currentExport !== 'undefined') {
              currentExport.whereUsed.delete(file);
            }
          }
        }
      });

      newDefaultImports.forEach(value => {
        if (!oldDefaultImports.has(value)) {
          let imports = oldImportPaths.get(value);
          if (typeof imports === 'undefined') {
            imports = new Set();
          }
          imports.add(IMPORT_DEFAULT_SPECIFIER);
          oldImportPaths.set(value, imports);

          let exports = exportList.get(value);
          let currentExport;
          if (typeof exports !== 'undefined') {
            currentExport = exports.get(IMPORT_DEFAULT_SPECIFIER);
          } else {
            exports = new Map();
            exportList.set(value, exports);
          }

          if (typeof currentExport !== 'undefined') {
            currentExport.whereUsed.add(file);
          } else {
            const whereUsed = new Set();
            whereUsed.add(file);
            exports.set(IMPORT_DEFAULT_SPECIFIER, { whereUsed });
          }
        }
      });

      oldDefaultImports.forEach(value => {
        if (!newDefaultImports.has(value)) {
          const imports = oldImportPaths.get(value);
          imports.delete(IMPORT_DEFAULT_SPECIFIER);

          const exports = exportList.get(value);
          if (typeof exports !== 'undefined') {
            const currentExport = exports.get(IMPORT_DEFAULT_SPECIFIER);
            if (typeof currentExport !== 'undefined') {
              currentExport.whereUsed.delete(file);
            }
          }
        }
      });

      newNamespaceImports.forEach(value => {
        if (!oldNamespaceImports.has(value)) {
          let imports = oldImportPaths.get(value);
          if (typeof imports === 'undefined') {
            imports = new Set();
          }
          imports.add(IMPORT_NAMESPACE_SPECIFIER);
          oldImportPaths.set(value, imports);

          let exports = exportList.get(value);
          let currentExport;
          if (typeof exports !== 'undefined') {
            currentExport = exports.get(IMPORT_NAMESPACE_SPECIFIER);
          } else {
            exports = new Map();
            exportList.set(value, exports);
          }

          if (typeof currentExport !== 'undefined') {
            currentExport.whereUsed.add(file);
          } else {
            const whereUsed = new Set();
            whereUsed.add(file);
            exports.set(IMPORT_NAMESPACE_SPECIFIER, { whereUsed });
          }
        }
      });

      oldNamespaceImports.forEach(value => {
        if (!newNamespaceImports.has(value)) {
          const imports = oldImportPaths.get(value);
          imports.delete(IMPORT_NAMESPACE_SPECIFIER);

          const exports = exportList.get(value);
          if (typeof exports !== 'undefined') {
            const currentExport = exports.get(IMPORT_NAMESPACE_SPECIFIER);
            if (typeof currentExport !== 'undefined') {
              currentExport.whereUsed.delete(file);
            }
          }
        }
      });

      newImports.forEach((value, key) => {
        if (!oldImports.has(key)) {
          let imports = oldImportPaths.get(value);
          if (typeof imports === 'undefined') {
            imports = new Set();
          }
          imports.add(key);
          oldImportPaths.set(value, imports);

          let exports = exportList.get(value);
          let currentExport;
          if (typeof exports !== 'undefined') {
            currentExport = exports.get(key);
          } else {
            exports = new Map();
            exportList.set(value, exports);
          }

          if (typeof currentExport !== 'undefined') {
            currentExport.whereUsed.add(file);
          } else {
            const whereUsed = new Set();
            whereUsed.add(file);
            exports.set(key, { whereUsed });
          }
        }
      });

      oldImports.forEach((value, key) => {
        if (!newImports.has(key)) {
          const imports = oldImportPaths.get(value);
          imports.delete(key);

          const exports = exportList.get(value);
          if (typeof exports !== 'undefined') {
            const currentExport = exports.get(key);
            if (typeof currentExport !== 'undefined') {
              currentExport.whereUsed.delete(file);
            }
          }
        }
      });
    };

    return {
      'Program:exit': node => {
        updateExportUsage(node);
        updateImportUsage(node);
        checkExportPresence(node);
      },
      'ExportDefaultDeclaration': node => {
        checkUsage(node, IMPORT_DEFAULT_SPECIFIER);
      },
      'ExportNamedDeclaration': node => {
        node.specifiers.forEach(specifier => {
          checkUsage(node, specifier.exported.name);
        });
        forEachDeclarationIdentifier(node.declaration, name => {
          checkUsage(node, name);
        });
      } };

  } };
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9ydWxlcy9uby11bnVzZWQtbW9kdWxlcy5qcyJdLCJuYW1lcyI6WyJsaXN0RmlsZXNUb1Byb2Nlc3MiLCJGaWxlRW51bWVyYXRvciIsInJlcXVpcmUiLCJzcmMiLCJleHRlbnNpb25zIiwiZSIsIkFycmF5IiwiZnJvbSIsIml0ZXJhdGVGaWxlcyIsImZpbGVQYXRoIiwiaWdub3JlZCIsImZpbGVuYW1lIiwiZTEiLCJvcmlnaW5hbExpc3RGaWxlc1RvUHJvY2VzcyIsImUyIiwicGF0dGVybnMiLCJyZWR1Y2UiLCJjYXJyeSIsInBhdHRlcm4iLCJjb25jYXQiLCJtYXAiLCJleHRlbnNpb24iLCJ0ZXN0Iiwic2xpY2UiLCJFWFBPUlRfREVGQVVMVF9ERUNMQVJBVElPTiIsIkVYUE9SVF9OQU1FRF9ERUNMQVJBVElPTiIsIkVYUE9SVF9BTExfREVDTEFSQVRJT04iLCJJTVBPUlRfREVDTEFSQVRJT04iLCJJTVBPUlRfTkFNRVNQQUNFX1NQRUNJRklFUiIsIklNUE9SVF9ERUZBVUxUX1NQRUNJRklFUiIsIlZBUklBQkxFX0RFQ0xBUkFUSU9OIiwiRlVOQ1RJT05fREVDTEFSQVRJT04iLCJDTEFTU19ERUNMQVJBVElPTiIsIlRTX0lOVEVSRkFDRV9ERUNMQVJBVElPTiIsIlRTX1RZUEVfQUxJQVNfREVDTEFSQVRJT04iLCJUU19FTlVNX0RFQ0xBUkFUSU9OIiwiREVGQVVMVCIsImZvckVhY2hEZWNsYXJhdGlvbklkZW50aWZpZXIiLCJkZWNsYXJhdGlvbiIsImNiIiwidHlwZSIsImlkIiwibmFtZSIsImRlY2xhcmF0aW9ucyIsImZvckVhY2giLCJpbXBvcnRMaXN0IiwiTWFwIiwiZXhwb3J0TGlzdCIsImlnbm9yZWRGaWxlcyIsIlNldCIsImZpbGVzT3V0c2lkZVNyYyIsImlzTm9kZU1vZHVsZSIsInBhdGgiLCJyZXNvbHZlRmlsZXMiLCJpZ25vcmVFeHBvcnRzIiwiY29udGV4dCIsInNldHRpbmdzIiwic3JjRmlsZXMiLCJzcmNGaWxlTGlzdCIsImlnbm9yZWRGaWxlc0xpc3QiLCJhZGQiLCJmaWx0ZXIiLCJwcmVwYXJlSW1wb3J0c0FuZEV4cG9ydHMiLCJleHBvcnRBbGwiLCJmaWxlIiwiZXhwb3J0cyIsImltcG9ydHMiLCJjdXJyZW50RXhwb3J0cyIsIkV4cG9ydHMiLCJnZXQiLCJkZXBlbmRlbmNpZXMiLCJyZWV4cG9ydHMiLCJsb2NhbEltcG9ydExpc3QiLCJuYW1lc3BhY2UiLCJjdXJyZW50RXhwb3J0QWxsIiwiZ2V0RGVwZW5kZW5jeSIsImRlcGVuZGVuY3kiLCJzZXQiLCJ2YWx1ZSIsImtleSIsIndoZXJlVXNlZCIsInJlZXhwb3J0IiwiZ2V0SW1wb3J0IiwibG9jYWxJbXBvcnQiLCJjdXJyZW50VmFsdWUiLCJsb2NhbCIsImltcG9ydGVkU3BlY2lmaWVycyIsImhhcyIsInZhbCIsImN1cnJlbnRFeHBvcnQiLCJkZXRlcm1pbmVVc2FnZSIsImxpc3RWYWx1ZSIsImxpc3RLZXkiLCJjdXJyZW50SW1wb3J0Iiwic3BlY2lmaWVyIiwiZXhwb3J0U3RhdGVtZW50IiwiZ2V0U3JjIiwicHJvY2VzcyIsImN3ZCIsImxhc3RQcmVwYXJlS2V5IiwiZG9QcmVwYXJhdGlvbiIsInByZXBhcmVLZXkiLCJKU09OIiwic3RyaW5naWZ5Iiwic29ydCIsImNsZWFyIiwibmV3TmFtZXNwYWNlSW1wb3J0RXhpc3RzIiwic3BlY2lmaWVycyIsInNvbWUiLCJuZXdEZWZhdWx0SW1wb3J0RXhpc3RzIiwiZmlsZUlzSW5Qa2ciLCJyZWFkUGtnVXAiLCJzeW5jIiwibm9ybWFsaXplIiwicGtnIiwiYmFzZVBhdGgiLCJjaGVja1BrZ0ZpZWxkU3RyaW5nIiwicGtnRmllbGQiLCJjaGVja1BrZ0ZpZWxkT2JqZWN0IiwicGtnRmllbGRGaWxlcyIsImNoZWNrUGtnRmllbGQiLCJwcml2YXRlIiwiYmluIiwiYnJvd3NlciIsIm1haW4iLCJtb2R1bGUiLCJtZXRhIiwiZG9jcyIsInVybCIsInNjaGVtYSIsInByb3BlcnRpZXMiLCJkZXNjcmlwdGlvbiIsIm1pbkl0ZW1zIiwiaXRlbXMiLCJtaW5MZW5ndGgiLCJtaXNzaW5nRXhwb3J0cyIsInVudXNlZEV4cG9ydHMiLCJub3QiLCJlbnVtIiwiYW55T2YiLCJyZXF1aXJlZCIsImNyZWF0ZSIsIm9wdGlvbnMiLCJnZXRGaWxlbmFtZSIsImNoZWNrRXhwb3J0UHJlc2VuY2UiLCJub2RlIiwiZXhwb3J0Q291bnQiLCJuYW1lc3BhY2VJbXBvcnRzIiwiZGVsZXRlIiwic2l6ZSIsInJlcG9ydCIsImJvZHkiLCJjaGVja1VzYWdlIiwiZXhwb3J0ZWRWYWx1ZSIsImV4cG9ydHNLZXkiLCJ1cGRhdGVFeHBvcnRVc2FnZSIsIm5ld0V4cG9ydHMiLCJuZXdFeHBvcnRJZGVudGlmaWVycyIsImxlbmd0aCIsImV4cG9ydGVkIiwidXBkYXRlSW1wb3J0VXNhZ2UiLCJvbGRJbXBvcnRQYXRocyIsIm9sZE5hbWVzcGFjZUltcG9ydHMiLCJuZXdOYW1lc3BhY2VJbXBvcnRzIiwib2xkRXhwb3J0QWxsIiwibmV3RXhwb3J0QWxsIiwib2xkRGVmYXVsdEltcG9ydHMiLCJuZXdEZWZhdWx0SW1wb3J0cyIsIm9sZEltcG9ydHMiLCJuZXdJbXBvcnRzIiwiYXN0Tm9kZSIsInJlc29sdmVkUGF0aCIsInNvdXJjZSIsInJhdyIsInJlcGxhY2UiLCJpbXBvcnRlZCJdLCJtYXBwaW5ncyI6Ijs7Ozs7O0FBTUEseUM7QUFDQTtBQUNBLHNEO0FBQ0EscUM7QUFDQTtBQUNBLHdDO0FBQ0EsdUM7QUFDQSwrQyxtVkFiQTs7OztzWUFlQTtBQUNBO0FBQ0EsSUFBSUEsa0JBQUosQ0FDQSxJQUFJLENBQ0YsTUFBTUMsaUJBQWlCQyxRQUFRLHVDQUFSLEVBQWlERCxjQUF4RTtBQUNBRCx1QkFBcUIsVUFBVUcsR0FBVixFQUFlQyxVQUFmLEVBQTJCO0FBQzlDLFVBQU1DLElBQUksSUFBSUosY0FBSixDQUFtQjtBQUMzQkcsa0JBQVlBLFVBRGUsRUFBbkIsQ0FBVjs7QUFHQSxXQUFPRSxNQUFNQyxJQUFOLENBQVdGLEVBQUVHLFlBQUYsQ0FBZUwsR0FBZixDQUFYLEVBQWdD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TCxrQ0FBNEJBLFFBQVE7QUFDbENPLG1CQUFXUCxJQUFYLEVBQWlCcEgsd0JBQWpCO0FBQ0QsT0FSSTtBQVNMLGdDQUEwQm9ILFFBQVE7QUFDaENBLGFBQUt0QyxVQUFMLENBQWdCL0QsT0FBaEIsQ0FBd0JrRCxhQUFhO0FBQ2pDMEQscUJBQVdQLElBQVgsRUFBaUJuRCxVQUFVaUUsUUFBVixDQUFtQnJILElBQXBDO0FBQ0gsU0FGRDtBQUdBTCxxQ0FBNkI0RyxLQUFLM0csV0FBbEMsRUFBZ0RJLElBQUQsSUFBVTtBQUN2RDhHLHFCQUFXUCxJQUFYLEVBQWlCdkcsSUFBakI7QUFDRCxTQUZEO0FBR0QsT0FoQkksRUFBUDs7QUFrQkQsR0E1Z0JjLEVBQWpCIiwiZmlsZSI6Im5vLXVudXNlZC1tb2R1bGVzLmpzIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBAZmlsZU92ZXJ2aWV3IEVuc3VyZXMgdGhhdCBtb2R1bGVzIGNvbnRhaW4gZXhwb3J0cyBhbmQvb3IgYWxsXG4gKiBtb2R1bGVzIGFyZSBjb25zdW1lZCB3aXRoaW4gb3RoZXIgbW9kdWxlcy5cbiAqIEBhdXRob3IgUmVuw6kgRmVybWFublxuICovXG5cbmltcG9ydCBFeHBvcnRzIGZyb20gJy4uL0V4cG9ydE1hcCdcbmltcG9ydCB7IGdldEZpbGVFeHRlbnNpb25zIH0gZnJvbSAnZXNsaW50LW1vZHVsZS11dGlscy9pZ25vcmUnXG5pbXBvcnQgcmVzb2x2ZSBmcm9tICdlc2xpbnQtbW9kdWxlLXV0aWxzL3Jlc29sdmUnXG5pbXBvcnQgZG9jc1VybCBmcm9tICcuLi9kb2NzVXJsJ1xuaW1wb3J0IHsgZGlybmFtZSwgam9pbiB9IGZyb20gJ3BhdGgnXG5pbXBvcnQgcmVhZFBrZ1VwIGZyb20gJ3JlYWQtcGtnLXVwJ1xuaW1wb3J0IHZhbHVlcyBmcm9tICdvYmplY3QudmFsdWVzJ1xuaW1wb3J0IGluY2x1ZGVzIGZyb20gJ2FycmF5LWluY2x1ZGVzJ1xuXG4vLyBlc2xpbnQvbGliL3V0aWwvZ2xvYi11dGlsIGhhcyBiZWVuIG1vdmVkIHRvIGVzbGludC9saWIvdXRpbC9nbG9iLXV0aWxzIHdpdGggdmVyc2lvbiA1LjNcbi8vIGFuZCBoYXMgYmVlbiBtb3ZlZCB0byBlc2xpbnQvbGliL2NsaS1lbmdpbmUvZmlsZS1lbnVtZXJhdG9yIGluIHZlcnNpb24gNlxubGV0IGxpc3RGaWxlc1RvUHJvY2Vzc1xudHJ5IHtcbiAgY29uc3QgRmlsZUVudW1lcmF0b3IgPSByZXF1aXJlKCdlc2xpbnQvbGliL2NsaS1lbmdpbmUvZmlsZS1lbnVtZXJhdG9yJykuRmlsZUVudW1lcmF0b3JcbiAgbGlzdEZpbGVzVG9Qcm9jZXNzID0gZnVuY3Rpb24gKHNyYywgZXh0ZW5zaW9ucykge1xuICAgIGNvbnN0IGUgPSBuZXcgRmlsZUVudW1lcmF0b3Ioe1xuICAgICAgZXh0ZW5zaW9uczogZXh0ZW5zaW9ucyxcbiAgICB9KVxuICAgIHJldHVybiBBcnJheS5mcm9tKGUuaXRlcmF0ZUZpbGVzKHNyYyksICh7IGZpbGVQYXRoLCBpZ25vcmVkIH0pID0+ICh7XG4gICAgICBpZ25vcmVkLFxuICAgICAgZmlsZW5hbWU6IGZpbGVQYXRoLFxuICAgIH0pKVxuICB9XG59IGNhdGNoIChlMSkge1xuICAvLyBQcmV2ZW50IHBhc3NpbmcgaW52YWxpZCBvcHRpb25zIChleHRlbnNpb25zIGFycmF5KSB0byBvbGQgdmVyc2lvbnMgb2YgdGhlIGZ1bmN0aW9uLlxuICAvLyBodHRwczovL2dpdGh1Yi5jb20vZXNsaW50L2VzbGludC9ibG9iL3Y1LjE2LjAvbGliL3V0aWwvZ2xvYi11dGlscy5qcyNMMTc4LUwyODBcbiAgLy8gaHR0cHM6Ly9naXRodWIuY29tL2VzbGludC9lc2xpbnQvYmxvYi92NS4yLjAvbGliL3V0aWwvZ2xvYi11dGlsLmpzI0wxNzQtTDI2OVxuICBsZXQgb3JpZ2luYWxMaXN0RmlsZXNUb1Byb2Nlc3NcbiAgdHJ5IHtcbiAgICBvcmlnaW5hbExpc3RGaWxlc1RvUHJvY2VzcyA9IHJlcXVpcmUoJ2VzbGludC9saWIvdXRpbC9nbG9iLXV0aWxzJykubGlzdEZpbGVzVG9Qcm9jZXNzXG4gICAgbGlzdEZpbGVzVG9Qcm9jZXNzID0gZnVuY3Rpb24gKHNyYywgZXh0ZW5zaW9ucykge1xuICAgICAgcmV0dXJuIG9yaWdpbmFsTGlzdEZpbGVzVG9Qcm9jZXNzKHNyYywge1xuICAgICAgICBleHRlbnNpb25zOiBleHRlbnNpb25zLFxuICAgICAgfSlcbiAgICB9XG4gIH0gY2F0Y2ggKGUyKSB7XG4gICAgb3JpZ2luYWxMaXN0RmlsZXNUb1Byb2Nlc3MgPSByZXF1aXJlKCdlc2xpbnQvbGliL3V0aWwvZ2xvYi11dGlsJykubGlzdEZpbGVzVG9Qcm9jZXNzXG5cbiAgICBsaXN0RmlsZXNUb1Byb2Nlc3MgPSBmdW5jdGlvbiAoc3JjLCBleHRlbnNpb25zKSB7XG4gICAgICBjb25zdCBwYXR0ZXJucyA9IHNyYy5yZWR1Y2UoKGNhcnJ5LCBwYXR0ZXJuKSA9PiB7XG4gICAgICAgIHJldHVybiBjYXJyeS5jb25jYXQoZXh0ZW5zaW9ucy5tYXAoKGV4dGVuc2lvbikgPT4ge1xuICAgICAgICAgIHJldHVybiAvXFwqXFwqfFxcKlxcLi8udGVzdChwYXR0ZXJuKSA/IHBhdHRlcm4gOiBgJHtwYXR0ZXJufS8qKi8qJHtleHRlbnNpb259YFxuICAgICAgICB9KSlcbiAgICAgIH0sIHNyYy5zbGljZSgpKVxuXG4gICAgICByZXR1cm4gb3JpZ2luYWxMaXN0RmlsZXNUb1Byb2Nlc3MocGF0dGVybnMpXG4gICAgfVxuICB9XG59XG5cbmNvbnN0IEVYUE9SVF9ERUZBVUxUX0RFQ0xBUkFUSU9OID0gJ0V4cG9ydERlZmF1bHREZWNsYXJhdGlvbidcbmNvbnN0IEVYUE9SVF9OQU1FRF9ERUNMQVJBVElPTiA9ICdFeHBvcnROYW1lZERlY2xhcmF0aW9uJ1xuY29uc3QgRVhQT1JUX0FMTF9ERUNMQVJBVElPTiA9ICdFeHBvcnRBbGxEZWNsYXJhdGlvbidcbmNvbnN0IElNUE9SVF9ERUNMQVJBVElPTiA9ICdJbXBvcnREZWNsYXJhdGlvbidcbmNvbnN0IElNUE9SVF9OQU1FU1BBQ0VfU1BFQ0lGSUVSID0gJ0ltcG9ydE5hbWVzcGFjZVNwZWNpZmllcidcbmNvbnN0IElNUE9SVF9ERUZBVUxUX1NQRUNJRklFUiA9ICdJbXBvcnREZWZhdWx0U3BlY2lmaWVyJ1xuY29uc3QgVkFSSUFCTEVfREVDTEFSQVRJT04gPSAnVmFyaWFibGVEZWNsYXJhdGlvbidcbmNvbnN0IEZVTkNUSU9OX0RFQ0xBUkFUSU9OID0gJ0Z1bmN0aW9uRGVjbGFyYXRpb24nXG5jb25zdCBDTEFTU19ERUNMQVJBVElPTiA9ICdDbGFzc0RlY2xhcmF0aW9uJ1xuY29uc3QgVFNfSU5URVJGQUNFX0RFQ0xBUkFUSU9OID0gJ1RTSW50ZXJmYWNlRGVjbGFyYXRpb24nXG5jb25zdCBUU19UWVBFX0FMSUFTX0RFQ0xBUkFUSU9OID0gJ1RTVHlwZUFsaWFzRGVjbGFyYXRpb24nXG5jb25zdCBUU19FTlVNX0RFQ0xBUkFUSU9OID0gJ1RTRW51bURlY2xhcmF0aW9uJ1xuY29uc3QgREVGQVVMVCA9ICdkZWZhdWx0J1xuXG5mdW5jdGlvbiBmb3JFYWNoRGVjbGFyYXRpb25JZGVudGlmaWVyKGRlY2xhcmF0aW9uLCBjYikge1xuICBpZiAoZGVjbGFyYXRpb24pIHtcbiAgICBpZiAoXG4gICAgICBkZWNsYXJhdGlvbi50eXBlID09PSBGVU5DVElPTl9ERUNMQVJBVElPTiB8fFxuICAgICAgZGVjbGFyYXRpb24udHlwZSA9PT0gQ0xBU1NfREVDTEFSQVRJT04gfHxcbiAgICAgIGRlY2xhcmF0aW9uLnR5cGUgPT09IFRTX0lOVEVSRkFDRV9ERUNMQVJBVElPTiB8fFxuICAgICAgZGVjbGFyYXRpb24udHlwZSA9PT0gVFNfVFlQRV9BTElBU19ERUNMQVJBVElPTiB8fFxuICAgICAgZGVjbGFyYXRpb24udHlwZSA9PT0gVFNfRU5VTV9ERUNMQVJBVElPTlxuICAgICkge1xuICAgICAgY2IoZGVjbGFyYXRpb24uaWQubmFtZSlcbiAgICB9IGVsc2UgaWYgKGRlY2xhcmF0aW9uLnR5cGUgPT09IFZBUklBQkxFX0RFQ0xBUkFUSU9OKSB7XG4gICAgICBkZWNsYXJhdGlvbi5kZWNsYXJhdGlvbnMuZm9yRWFjaCgoeyBpZCB9KSA9PiB7XG4gICAgICAgIGNiKGlkLm5hbWUpXG4gICAgICB9KVxuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIExpc3Qgb2YgaW1wb3J0cyBwZXIgZmlsZS5cbiAqXG4gKiBSZXByZXNlbnRlZCBieSBhIHR3by1sZXZlbCBNYXAgdG8gYSBTZXQgb2YgaWRlbnRpZmllcnMuIFRoZSB1cHBlci1sZXZlbCBNYXBcbiAqIGtleXMgYXJlIHRoZSBwYXRocyB0byB0aGUgbW9kdWxlcyBjb250YWluaW5nIHRoZSBpbXBvcnRzLCB3aGlsZSB0aGVcbiAqIGxvd2VyLWxldmVsIE1hcCBrZXlzIGFyZSB0aGUgcGF0aHMgdG8gdGhlIGZpbGVzIHdoaWNoIGFyZSBiZWluZyBpbXBvcnRlZFxuICogZnJvbS4gTGFzdGx5LCB0aGUgU2V0IG9mIGlkZW50aWZpZXJzIGNvbnRhaW5zIGVpdGhlciBuYW1lcyBiZWluZyBpbXBvcnRlZFxuICogb3IgYSBzcGVjaWFsIEFTVCBub2RlIG5hbWUgbGlzdGVkIGFib3ZlIChlLmcgSW1wb3J0RGVmYXVsdFNwZWNpZmllcikuXG4gKlxuICogRm9yIGV4YW1wbGUsIGlmIHdlIGhhdmUgYSBmaWxlIG5hbWVkIGZvby5qcyBjb250YWluaW5nOlxuICpcbiAqICAgaW1wb3J0IHsgbzIgfSBmcm9tICcuL2Jhci5qcyc7XG4gKlxuICogVGhlbiB3ZSB3aWxsIGhhdmUgYSBzdHJ1Y3R1cmUgdGhhdCBsb29rcyBsaWtlOlxuICpcbiAqICAgTWFwIHsgJ2Zvby5qcycgPT4gTWFwIHsgJ2Jhci5qcycgPT4gU2V0IHsgJ28yJyB9IH0gfVxuICpcbiAqIEB0eXBlIHtNYXA8c3RyaW5nLCBNYXA8c3RyaW5nLCBTZXQ8c3RyaW5nPj4+fVxuICovXG5jb25zdCBpbXBvcnRMaXN0ID0gbmV3IE1hcCgpXG5cbi8qKlxuICogTGlzdCBvZiBleHBvcnRzIHBlciBmaWxlLlxuICpcbiAqIFJlcHJlc2VudGVkIGJ5IGEgdHdvLWxldmVsIE1hcCB0byBhbiBvYmplY3Qgb2YgbWV0YWRhdGEuIFRoZSB1cHBlci1sZXZlbCBNYXBcbiAqIGtleXMgYXJlIHRoZSBwYXRocyB0byB0aGUgbW9kdWxlcyBjb250YWluaW5nIHRoZSBleHBvcnRzLCB3aGlsZSB0aGVcbiAqIGxvd2VyLWxldmVsIE1hcCBrZXlzIGFyZSB0aGUgc3BlY2lmaWMgaWRlbnRpZmllcnMgb3Igc3BlY2lhbCBBU1Qgbm9kZSBuYW1lc1xuICogYmVpbmcgZXhwb3J0ZWQuIFRoZSBsZWFmLWxldmVsIG1ldGFkYXRhIG9iamVjdCBhdCB0aGUgbW9tZW50IG9ubHkgY29udGFpbnMgYVxuICogYHdoZXJlVXNlZGAgcHJvcG9lcnR5LCB3aGljaCBjb250YWlucyBhIFNldCBvZiBwYXRocyB0byBtb2R1bGVzIHRoYXQgaW1wb3J0XG4gKiB0aGUgbmFtZS5cbiAqXG4gKiBGb3IgZXhhbXBsZSwgaWYgd2UgaGF2ZSBhIGZpbGUgbmFtZWQgYmFyLmpzIGNvbnRhaW5pbmcgdGhlIGZvbGxvd2luZyBleHBvcnRzOlxuICpcbiAqICAgY29uc3QgbzIgPSAnYmFyJztcbiAqICAgZXhwb3J0IHsgbzIgfTtcbiAqXG4gKiBBbmQgYSBmaWxlIG5hbWVkIGZvby5qcyBjb250YWluaW5nIHRoZSBmb2xsb3dpbmcgaW1wb3J0OlxuICpcbiAqICAgaW1wb3J0IHsgbzIgfSBmcm9tICcuL2Jhci5qcyc7XG4gKlxuICogVGhlbiB3ZSB3aWxsIGhhdmUgYSBzdHJ1Y3R1cmUgdGhhdCBsb29rcyBsaWtlOlxuICpcbiAqICAgTWFwIHsgJ2Jhci5qcycgPT4gTWFwIHsgJ28yJyA9PiB7IHdoZXJlVXNlZDogU2V0IHsgJ2Zvby5qcycgfSB9IH0gfVxuICpcbiAqIEB0eXBlIHtNYXA8c3RyaW5nLCBNYXA8c3RyaW5nLCBvYmplY3Q+Pn1cbiAqL1xuY29uc3QgZXhwb3J0TGlzdCA9IG5ldyBNYXAoKVxuXG5jb25zdCBpZ25vcmVkRmlsZXMgPSBuZXcgU2V0KClcbmNvbnN0IGZpbGVzT3V0c2lkZVNyYyA9IG5ldyBTZXQoKVxuXG5jb25zdCBpc05vZGVNb2R1bGUgPSBwYXRoID0+IHtcbiAgcmV0dXJuIC9cXC8obm9kZV9tb2R1bGVzKVxcLy8udGVzdChwYXRoKVxufVxuXG4vKipcbiAqIHJlYWQgYWxsIGZpbGVzIG1hdGNoaW5nIHRoZSBwYXR0ZXJucyBpbiBzcmMgYW5kIGlnbm9yZUV4cG9ydHNcbiAqXG4gKiByZXR1cm4gYWxsIGZpbGVzIG1hdGNoaW5nIHNyYyBwYXR0ZXJuLCB3aGljaCBhcmUgbm90IG1hdGNoaW5nIHRoZSBpZ25vcmVFeHBvcnRzIHBhdHRlcm5cbiAqL1xuY29uc3QgcmVzb2x2ZUZpbGVzID0gKHNyYywgaWdub3JlRXhwb3J0cywgY29udGV4dCkgPT4ge1xuICBjb25zdCBleHRlbnNpb25zID0gQXJyYXkuZnJvbShnZXRGaWxlRXh0ZW5zaW9ucyhjb250ZXh0LnNldHRpbmdzKSlcblxuICBjb25zdCBzcmNGaWxlcyA9IG5ldyBTZXQoKVxuICBjb25zdCBzcmNGaWxlTGlzdCA9IGxpc3RGaWxlc1RvUHJvY2VzcyhzcmMsIGV4dGVuc2lvbnMpXG5cbiAgLy8gcHJlcGFyZSBsaXN0IG9mIGlnbm9yZWQgZmlsZXNcbiAgY29uc3QgaWdub3JlZEZpbGVzTGlzdCA9ICBsaXN0RmlsZXNUb1Byb2Nlc3MoaWdub3JlRXhwb3J0cywgZXh0ZW5zaW9ucylcbiAgaWdub3JlZEZpbGVzTGlzdC5mb3JFYWNoKCh7IGZpbGVuYW1lIH0pID0+IGlnbm9yZWRGaWxlcy5hZGQoZmlsZW5hbWUpKVxuXG4gIC8vIHByZXBhcmUgbGlzdCBvZiBzb3VyY2UgZmlsZXMsIGRvbid0IGNvbnNpZGVyIGZpbGVzIGZyb20gbm9kZV9tb2R1bGVzXG4gIHNyY0ZpbGVMaXN0LmZpbHRlcigoeyBmaWxlbmFtZSB9KSA9PiAhaXNOb2RlTW9kdWxlKGZpbGVuYW1lKSkuZm9yRWFjaCgoeyBmaWxlbmFtZSB9KSA9PiB7XG4gICAgc3JjRmlsZXMuYWRkKGZpbGVuYW1lKVxuICB9KVxuICByZXR1cm4gc3JjRmlsZXNcbn1cblxuLyoqXG4gKiBwYXJzZSBhbGwgc291cmNlIGZpbGVzIGFuZCBidWlsZCB1cCAyIG1hcHMgY29udGFpbmluZyB0aGUgZXhpc3RpbmcgaW1wb3J0cyBhbmQgZXhwb3J0c1xuICovXG5jb25zdCBwcmVwYXJlSW1wb3J0c0FuZEV4cG9ydHMgPSAoc3JjRmlsZXMsIGNvbnRleHQpID0+IHtcbiAgY29uc3QgZXhwb3J0QWxsID0gbmV3IE1hcCgpXG4gIHNyY0ZpbGVzLmZvckVhY2goZmlsZSA9PiB7XG4gICAgY29uc3QgZXhwb3J0cyA9IG5ldyBNYXAoKVxuICAgIGNvbnN0IGltcG9ydHMgPSBuZXcgTWFwKClcbiAgICBjb25zdCBjdXJyZW50RXhwb3J0cyA9IEV4cG9ydHMuZ2V0KGZpbGUsIGNvbnRleHQpXG4gICAgaWYgKGN1cnJlbnRFeHBvcnRzKSB7XG4gICAgICBjb25zdCB7IGRlcGVuZGVuY2llcywgcmVleHBvcnRzLCBpbXBvcnRzOiBsb2NhbEltcG9ydExpc3QsIG5hbWVzcGFjZSAgfSA9IGN1cnJlbnRFeHBvcnRzXG5cbiAgICAgIC8vIGRlcGVuZGVuY2llcyA9PT0gZXhwb3J0ICogZnJvbVxuICAgICAgY29uc3QgY3VycmVudEV4cG9ydEFsbCA9IG5ldyBTZXQoKVxuICAgICAgZGVwZW5kZW5jaWVzLmZvckVhY2goZ2V0RGVwZW5kZW5jeSA9PiB7XG4gICAgICAgIGNvbnN0IGRlcGVuZGVuY3kgPSBnZXREZXBlbmRlbmN5KClcbiAgICAgICAgaWYgKGRlcGVuZGVuY3kgPT09IG51bGwpIHtcbiAgICAgICAgICByZXR1cm5cbiAgICAgICAgfVxuXG4gICAgICAgIGN1cnJlbnRFeHBvcnRBbGwuYWRkKGRlcGVuZGVuY3kucGF0aClcbiAgICAgIH0pXG4gICAgICBleHBvcnRBbGwuc2V0KGZpbGUsIGN1cnJlbnRFeHBvcnRBbGwpXG5cbiAgICAgIHJlZXhwb3J0cy5mb3JFYWNoKCh2YWx1ZSwga2V5KSA9PiB7XG4gICAgICAgIGlmIChrZXkgPT09IERFRkFVTFQpIHtcbiAgICAgICAgICBleHBvcnRzLnNldChJTVBPUlRfREVGQVVMVF9TUEVDSUZJRVIsIHsgd2hlcmVVc2VkOiBuZXcgU2V0KCkgfSlcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBleHBvcnRzLnNldChrZXksIHsgd2hlcmVVc2VkOiBuZXcgU2V0KCkgfSlcbiAgICAgICAgfVxuICAgICAgICBjb25zdCByZWV4cG9ydCA9ICB2YWx1ZS5nZXRJbXBvcnQoKVxuICAgICAgICBpZiAoIXJlZXhwb3J0KSB7XG4gICAgICAgICAgcmV0dXJuXG4gICAgICAgIH1cbiAgICAgICAgbGV0IGxvY2FsSW1wb3J0ID0gaW1wb3J0cy5nZXQocmVleHBvcnQucGF0aClcbiAgICAgICAgbGV0IGN1cnJlbnRWYWx1ZVxuICAgICAgICBpZiAodmFsdWUubG9jYWwgPT09IERFRkFVTFQpIHtcbiAgICAgICAgICBjdXJyZW50VmFsdWUgPSBJTVBPUlRfREVGQVVMVF9TUEVDSUZJRVJcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjdXJyZW50VmFsdWUgPSB2YWx1ZS5sb2NhbFxuICAgICAgICB9XG4gICAgICAgIGlmICh0eXBlb2YgbG9jYWxJbXBvcnQgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgICAgICAgbG9jYWxJbXBvcnQgPSBuZXcgU2V0KFsuLi5sb2NhbEltcG9ydCwgY3VycmVudFZhbHVlXSlcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBsb2NhbEltcG9ydCA9IG5ldyBTZXQoW2N1cnJlbnRWYWx1ZV0pXG4gICAgICAgIH1cbiAgICAgICAgaW1wb3J0cy5zZXQocmVleHBvcnQucGF0aCwgbG9jYWxJbXBvcnQpXG4gICAgICB9KVxuXG4gICAgICBsb2NhbEltcG9ydExpc3QuZm9yRWFjaCgodmFsdWUsIGtleSkgPT4ge1xuICAgICAgICBpZiAoaXNOb2RlTW9kdWxlKGtleSkpIHtcbiAgICAgICAgICByZXR1cm5cbiAgICAgICAgfVxuICAgICAgICBsZXQgbG9jYWxJbXBvcnQgPSBpbXBvcnRzLmdldChrZXkpXG4gICAgICAgIGlmICh0eXBlb2YgbG9jYWxJbXBvcnQgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgICAgICAgbG9jYWxJbXBvcnQgPSBuZXcgU2V0KFsuLi5sb2NhbEltcG9ydCwgLi4udmFsdWUuaW1wb3J0ZWRTcGVjaWZpZXJzXSlcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBsb2NhbEltcG9ydCA9IHZhbHVlLmltcG9ydGVkU3BlY2lmaWVyc1xuICAgICAgICB9XG4gICAgICAgIGltcG9ydHMuc2V0KGtleSwgbG9jYWxJbXBvcnQpXG4gICAgICB9KVxuICAgICAgaW1wb3J0TGlzdC5zZXQoZmlsZSwgaW1wb3J0cylcblxuICAgICAgLy8gYnVpbGQgdXAgZXhwb3J0IGxpc3Qgb25seSwgaWYgZmlsZSBpcyBub3QgaWdub3JlZFxuICAgICAgaWYgKGlnbm9yZWRGaWxlcy5oYXMoZmlsZSkpIHtcbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG4gICAgICBuYW1lc3BhY2UuZm9yRWFjaCgodmFsdWUsIGtleSkgPT4ge1xuICAgICAgICBpZiAoa2V5ID09PSBERUZBVUxUKSB7XG4gICAgICAgICAgZXhwb3J0cy5zZXQoSU1QT1JUX0RFRkFVTFRfU1BFQ0lGSUVSLCB7IHdoZXJlVXNlZDogbmV3IFNldCgpIH0pXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgZXhwb3J0cy5zZXQoa2V5LCB7IHdoZXJlVXNlZDogbmV3IFNldCgpIH0pXG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgfVxuICAgIGV4cG9ydHMuc2V0KEVYUE9SVF9BTExfREVDTEFSQVRJT04sIHsgd2hlcmVVc2VkOiBuZXcgU2V0KCkgfSlcbiAgICBleHBvcnRzLnNldChJTVBPUlRfTkFNRVNQQUNFX1NQRUNJRklFUiwgeyB3aGVyZVVzZWQ6IG5ldyBTZXQoKSB9KVxuICAgIGV4cG9ydExpc3Quc2V0KGZpbGUsIGV4cG9ydHMpXG4gIH0pXG4gIGV4cG9ydEFsbC5mb3JFYWNoKCh2YWx1ZSwga2V5KSA9PiB7XG4gICAgdmFsdWUuZm9yRWFjaCh2YWwgPT4ge1xuICAgICAgY29uc3QgY3VycmVudEV4cG9ydHMgPSBleHBvcnRMaXN0LmdldCh2YWwpXG4gICAgICBjb25zdCBjdXJyZW50RXhwb3J0ID0gY3VycmVudEV4cG9ydHMuZ2V0KEVYUE9SVF9BTExfREVDTEFSQVRJT04pXG4gICAgICBjdXJyZW50RXhwb3J0LndoZXJlVXNlZC5hZGQoa2V5KVxuICAgIH0pXG4gIH0pXG59XG5cbi8qKlxuICogdHJhdmVyc2UgdGhyb3VnaCBhbGwgaW1wb3J0cyBhbmQgYWRkIHRoZSByZXNwZWN0aXZlIHBhdGggdG8gdGhlIHdoZXJlVXNlZC1saXN0XG4gKiBvZiB0aGUgY29ycmVzcG9uZGluZyBleHBvcnRcbiAqL1xuY29uc3QgZGV0ZXJtaW5lVXNhZ2UgPSAoKSA9PiB7XG4gIGltcG9ydExpc3QuZm9yRWFjaCgobGlzdFZhbHVlLCBsaXN0S2V5KSA9PiB7XG4gICAgbGlzdFZhbHVlLmZvckVhY2goKHZhbHVlLCBrZXkpID0+IHtcbiAgICAgIGNvbnN0IGV4cG9ydHMgPSBleHBvcnRMaXN0LmdldChrZXkpXG4gICAgICBpZiAodHlwZW9mIGV4cG9ydHMgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgICAgIHZhbHVlLmZvckVhY2goY3VycmVudEltcG9ydCA9PiB7XG4gICAgICAgICAgbGV0IHNwZWNpZmllclxuICAgICAgICAgIGlmIChjdXJyZW50SW1wb3J0ID09PSBJTVBPUlRfTkFNRVNQQUNFX1NQRUNJRklFUikge1xuICAgICAgICAgICAgc3BlY2lmaWVyID0gSU1QT1JUX05BTUVTUEFDRV9TUEVDSUZJRVJcbiAgICAgICAgICB9IGVsc2UgaWYgKGN1cnJlbnRJbXBvcnQgPT09IElNUE9SVF9ERUZBVUxUX1NQRUNJRklFUikge1xuICAgICAgICAgICAgc3BlY2lmaWVyID0gSU1QT1JUX0RFRkFVTFRfU1BFQ0lGSUVSXG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHNwZWNpZmllciA9IGN1cnJlbnRJbXBvcnRcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKHR5cGVvZiBzcGVjaWZpZXIgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgICAgICAgICBjb25zdCBleHBvcnRTdGF0ZW1lbnQgPSBleHBvcnRzLmdldChzcGVjaWZpZXIpXG4gICAgICAgICAgICBpZiAodHlwZW9mIGV4cG9ydFN0YXRlbWVudCAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgICAgICAgICAgY29uc3QgeyB3aGVyZVVzZWQgfSA9IGV4cG9ydFN0YXRlbWVudFxuICAgICAgICAgICAgICB3aGVyZVVzZWQuYWRkKGxpc3RLZXkpXG4gICAgICAgICAgICAgIGV4cG9ydHMuc2V0KHNwZWNpZmllciwgeyB3aGVyZVVzZWQgfSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgICB9XG4gICAgfSlcbiAgfSlcbn1cblxuY29uc3QgZ2V0U3JjID0gc3JjID0+IHtcbiAgaWYgKHNyYykge1xuICAgIHJldHVybiBzcmNcbiAgfVxuICByZXR1cm4gW3Byb2Nlc3MuY3dkKCldXG59XG5cbi8qKlxuICogcHJlcGFyZSB0aGUgbGlzdHMgb2YgZXhpc3RpbmcgaW1wb3J0cyBhbmQgZXhwb3J0cyAtIHNob3VsZCBvbmx5IGJlIGV4ZWN1dGVkIG9uY2UgYXRcbiAqIHRoZSBzdGFydCBvZiBhIG5ldyBlc2xpbnQgcnVuXG4gKi9cbmxldCBzcmNGaWxlc1xubGV0IGxhc3RQcmVwYXJlS2V5XG5jb25zdCBkb1ByZXBhcmF0aW9uID0gKHNyYywgaWdub3JlRXhwb3J0cywgY29udGV4dCkgPT4ge1xuICBjb25zdCBwcmVwYXJlS2V5ID0gSlNPTi5zdHJpbmdpZnkoe1xuICAgIHNyYzogKHNyYyB8fCBbXSkuc29ydCgpLFxuICAgIGlnbm9yZUV4cG9ydHM6IChpZ25vcmVFeHBvcnRzIHx8IFtdKS5zb3J0KCksXG4gICAgZXh0ZW5zaW9uczogQXJyYXkuZnJvbShnZXRGaWxlRXh0ZW5zaW9ucyhjb250ZXh0LnNldHRpbmdzKSkuc29ydCgpLFxuICB9KVxuICBpZiAocHJlcGFyZUtleSA9PT0gbGFzdFByZXBhcmVLZXkpIHtcbiAgICByZXR1cm5cbiAgfVxuXG4gIGltcG9ydExpc3QuY2xlYXIoKVxuICBleHBvcnRMaXN0LmNsZWFyKClcbiAgaWdub3JlZEZpbGVzLmNsZWFyKClcbiAgZmlsZXNPdXRzaWRlU3JjLmNsZWFyKClcblxuICBzcmNGaWxlcyA9IHJlc29sdmVGaWxlcyhnZXRTcmMoc3JjKSwgaWdub3JlRXhwb3J0cywgY29udGV4dClcbiAgcHJlcGFyZUltcG9ydHNBbmRFeHBvcnRzKHNyY0ZpbGVzLCBjb250ZXh0KVxuICBkZXRlcm1pbmVVc2FnZSgpXG4gIGxhc3RQcmVwYXJlS2V5ID0gcHJlcGFyZUtleVxufVxuXG5jb25zdCBuZXdOYW1lc3BhY2VJbXBvcnRFeGlzdHMgPSBzcGVjaWZpZXJzID0+XG4gIHNwZWNpZmllcnMuc29tZSgoeyB0eXBlIH0pID0+IHR5cGUgPT09IElNUE9SVF9OQU1FU1BBQ0VfU1BFQ0lGSUVSKVxuXG5jb25zdCBuZXdEZWZhdWx0SW1wb3J0RXhpc3RzID0gc3BlY2lmaWVycyA9PlxuICBzcGVjaWZpZXJzLnNvbWUoKHsgdHlwZSB9KSA9PiB0eXBlID09PSBJTVBPUlRfREVGQVVMVF9TUEVDSUZJRVIpXG5cbmNvbnN0IGZpbGVJc0luUGtnID0gZmlsZSA9PiB7XG4gIGNvbnN0IHsgcGF0aCwgcGtnIH0gPSByZWFkUGtnVXAuc3luYyh7Y3dkOiBmaWxlLCBub3JtYWxpemU6IGZhbHNlfSlcbiAgY29uc3QgYmFzZVBhdGggPSBkaXJuYW1lKHBhdGgpXG5cbiAgY29uc3QgY2hlY2tQa2dGaWVsZFN0cmluZyA9IHBrZ0ZpZWxkID0+IHtcbiAgICBpZiAoam9pbihiYXNlUGF0aCwgcGtnRmllbGQpID09PSBmaWxlKSB7XG4gICAgICAgIHJldHVybiB0cnVlXG4gICAgICB9XG4gIH1cblxuICBjb25zdCBjaGVja1BrZ0ZpZWxkT2JqZWN0ID0gcGtnRmllbGQgPT4ge1xuICAgICAgY29uc3QgcGtnRmllbGRGaWxlcyA9IHZhbHVlcyhwa2dGaWVsZCkubWFwKHZhbHVlID0+IGpvaW4oYmFzZVBhdGgsIHZhbHVlKSlcbiAgICAgIGlmIChpbmNsdWRlcyhwa2dGaWVsZEZpbGVzLCBmaWxlKSkge1xuICAgICAgICByZXR1cm4gdHJ1ZVxuICAgICAgfVxuICB9XG5cbiAgY29uc3QgY2hlY2tQa2dGaWVsZCA9IHBrZ0ZpZWxkID0+IHtcbiAgICBpZiAodHlwZW9mIHBrZ0ZpZWxkID09PSAnc3RyaW5nJykge1xuICAgICAgcmV0dXJuIGNoZWNrUGtnRmllbGRTdHJpbmcocGtnRmllbGQpXG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBwa2dGaWVsZCA9PT0gJ29iamVjdCcpIHtcbiAgICAgIHJldHVybiBjaGVja1BrZ0ZpZWxkT2JqZWN0KHBrZ0ZpZWxkKVxuICAgIH1cbiAgfVxuXG4gIGlmIChwa2cucHJpdmF0ZSA9PT0gdHJ1ZSkge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgaWYgKHBrZy5iaW4pIHtcbiAgICBpZiAoY2hlY2tQa2dGaWVsZChwa2cuYmluKSkge1xuICAgICAgcmV0dXJuIHRydWVcbiAgICB9XG4gIH1cblxuICBpZiAocGtnLmJyb3dzZXIpIHtcbiAgICBpZiAoY2hlY2tQa2dGaWVsZChwa2cuYnJvd3NlcikpIHtcbiAgICAgIHJldHVybiB0cnVlXG4gICAgfVxuICB9XG5cbiAgaWYgKHBrZy5tYWluKSB7XG4gICAgaWYgKGNoZWNrUGtnRmllbGRTdHJpbmcocGtnLm1haW4pKSB7XG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBmYWxzZVxufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgbWV0YToge1xuICAgIHR5cGU6ICdzdWdnZXN0aW9uJyxcbiAgICBkb2NzOiB7IHVybDogZG9jc1VybCgnbm8tdW51c2VkLW1vZHVsZXMnKSB9LFxuICAgIHNjaGVtYTogW3tcbiAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgc3JjOiB7XG4gICAgICAgICAgZGVzY3JpcHRpb246ICdmaWxlcy9wYXRocyB0byBiZSBhbmFseXplZCAob25seSBmb3IgdW51c2VkIGV4cG9ydHMpJyxcbiAgICAgICAgICB0eXBlOiAnYXJyYXknLFxuICAgICAgICAgIG1pbkl0ZW1zOiAxLFxuICAgICAgICAgIGl0ZW1zOiB7XG4gICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgICAgIG1pbkxlbmd0aDogMSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgICBpZ25vcmVFeHBvcnRzOiB7XG4gICAgICAgICAgZGVzY3JpcHRpb246XG4gICAgICAgICAgICAnZmlsZXMvcGF0aHMgZm9yIHdoaWNoIHVudXNlZCBleHBvcnRzIHdpbGwgbm90IGJlIHJlcG9ydGVkIChlLmcgbW9kdWxlIGVudHJ5IHBvaW50cyknLFxuICAgICAgICAgIHR5cGU6ICdhcnJheScsXG4gICAgICAgICAgbWluSXRlbXM6IDEsXG4gICAgICAgICAgaXRlbXM6IHtcbiAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICAgICAgbWluTGVuZ3RoOiAxLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICAgIG1pc3NpbmdFeHBvcnRzOiB7XG4gICAgICAgICAgZGVzY3JpcHRpb246ICdyZXBvcnQgbW9kdWxlcyB3aXRob3V0IGFueSBleHBvcnRzJyxcbiAgICAgICAgICB0eXBlOiAnYm9vbGVhbicsXG4gICAgICAgIH0sXG4gICAgICAgIHVudXNlZEV4cG9ydHM6IHtcbiAgICAgICAgICBkZXNjcmlwdGlvbjogJ3JlcG9ydCBleHBvcnRzIHdpdGhvdXQgYW55IHVzYWdlJyxcbiAgICAgICAgICB0eXBlOiAnYm9vbGVhbicsXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgbm90OiB7XG4gICAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgICB1bnVzZWRFeHBvcnRzOiB7IGVudW06IFtmYWxzZV0gfSxcbiAgICAgICAgICBtaXNzaW5nRXhwb3J0czogeyBlbnVtOiBbZmFsc2VdIH0sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgYW55T2Y6W3tcbiAgICAgICAgbm90OiB7XG4gICAgICAgICAgcHJvcGVydGllczoge1xuICAgICAgICAgICAgdW51c2VkRXhwb3J0czogeyBlbnVtOiBbdHJ1ZV0gfSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgICByZXF1aXJlZDogWydtaXNzaW5nRXhwb3J0cyddLFxuICAgICAgfSwge1xuICAgICAgICBub3Q6IHtcbiAgICAgICAgICBwcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgICBtaXNzaW5nRXhwb3J0czogeyBlbnVtOiBbdHJ1ZV0gfSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgICByZXF1aXJlZDogWyd1bnVzZWRFeHBvcnRzJ10sXG4gICAgICB9LCB7XG4gICAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgICB1bnVzZWRFeHBvcnRzOiB7IGVudW06IFt0cnVlXSB9LFxuICAgICAgICB9LFxuICAgICAgICByZXF1aXJlZDogWyd1bnVzZWRFeHBvcnRzJ10sXG4gICAgICB9LCB7XG4gICAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgICBtaXNzaW5nRXhwb3J0czogeyBlbnVtOiBbdHJ1ZV0gfSxcbiAgICAgICAgfSxcbiAgICAgICAgcmVxdWlyZWQ6IFsnbWlzc2luZ0V4cG9ydHMnXSxcbiAgICAgIH1dLFxuICAgIH1dLFxuICB9LFxuXG4gIGNyZWF0ZTogY29udGV4dCA9PiB7XG4gICAgY29uc3Qge1xuICAgICAgc3JjLFxuICAgICAgaWdub3JlRXhwb3J0cyA9IFtdLFxuICAgICAgbWlzc2luZ0V4cG9ydHMsXG4gICAgICB1bnVzZWRFeHBvcnRzLFxuICAgIH0gPSBjb250ZXh0Lm9wdGlvbnNbMF0gfHwge31cblxuICAgIGlmICh1bnVzZWRFeHBvcnRzKSB7XG4gICAgICBkb1ByZXBhcmF0aW9uKHNyYywgaWdub3JlRXhwb3J0cywgY29udGV4dClcbiAgICB9XG5cbiAgICBjb25zdCBmaWxlID0gY29udGV4dC5nZXRGaWxlbmFtZSgpXG5cbiAgICBjb25zdCBjaGVja0V4cG9ydFByZXNlbmNlID0gbm9kZSA9PiB7XG4gICAgICBpZiAoIW1pc3NpbmdFeHBvcnRzKSB7XG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICBpZiAoaWdub3JlZEZpbGVzLmhhcyhmaWxlKSkge1xuICAgICAgICByZXR1cm5cbiAgICAgIH1cblxuICAgICAgY29uc3QgZXhwb3J0Q291bnQgPSBleHBvcnRMaXN0LmdldChmaWxlKVxuICAgICAgY29uc3QgZXhwb3J0QWxsID0gZXhwb3J0Q291bnQuZ2V0KEVYUE9SVF9BTExfREVDTEFSQVRJT04pXG4gICAgICBjb25zdCBuYW1lc3BhY2VJbXBvcnRzID0gZXhwb3J0Q291bnQuZ2V0KElNUE9SVF9OQU1FU1BBQ0VfU1BFQ0lGSUVSKVxuXG4gICAgICBleHBvcnRDb3VudC5kZWxldGUoRVhQT1JUX0FMTF9ERUNMQVJBVElPTilcbiAgICAgIGV4cG9ydENvdW50LmRlbGV0ZShJTVBPUlRfTkFNRVNQQUNFX1NQRUNJRklFUilcbiAgICAgIGlmIChleHBvcnRDb3VudC5zaXplIDwgMSkge1xuICAgICAgICAvLyBub2RlLmJvZHlbMF0gPT09ICd1bmRlZmluZWQnIG9ubHkgaGFwcGVucywgaWYgZXZlcnl0aGluZyBpcyBjb21tZW50ZWQgb3V0IGluIHRoZSBmaWxlXG4gICAgICAgIC8vIGJlaW5nIGxpbnRlZFxuICAgICAgICBjb250ZXh0LnJlcG9ydChub2RlLmJvZHlbMF0gPyBub2RlLmJvZHlbMF0gOiBub2RlLCAnTm8gZXhwb3J0cyBmb3VuZCcpXG4gICAgICB9XG4gICAgICBleHBvcnRDb3VudC5zZXQoRVhQT1JUX0FMTF9ERUNMQVJBVElPTiwgZXhwb3J0QWxsKVxuICAgICAgZXhwb3J0Q291bnQuc2V0KElNUE9SVF9OQU1FU1BBQ0VfU1BFQ0lGSUVSLCBuYW1lc3BhY2VJbXBvcnRzKVxuICAgIH1cblxuICAgIGNvbnN0IGNoZWNrVXNhZ2UgPSAobm9kZSwgZXhwb3J0ZWRWYWx1ZSkgPT4ge1xuICAgICAgaWYgKCF1bnVzZWRFeHBvcnRzKSB7XG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICBpZiAoaWdub3JlZEZpbGVzLmhhcyhmaWxlKSkge1xuICAgICAgICByZXR1cm5cbiAgICAgIH1cblxuICAgICAgaWYgKGZpbGVJc0luUGtnKGZpbGUpKSB7XG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICBpZiAoZmlsZXNPdXRzaWRlU3JjLmhhcyhmaWxlKSkge1xuICAgICAgICByZXR1cm5cbiAgICAgIH1cblxuICAgICAgLy8gbWFrZSBzdXJlIGZpbGUgdG8gYmUgbGludGVkIGlzIGluY2x1ZGVkIGluIHNvdXJjZSBmaWxlc1xuICAgICAgaWYgKCFzcmNGaWxlcy5oYXMoZmlsZSkpIHtcbiAgICAgICAgc3JjRmlsZXMgPSByZXNvbHZlRmlsZXMoZ2V0U3JjKHNyYyksIGlnbm9yZUV4cG9ydHMsIGNvbnRleHQpXG4gICAgICAgIGlmICghc3JjRmlsZXMuaGFzKGZpbGUpKSB7XG4gICAgICAgICAgZmlsZXNPdXRzaWRlU3JjLmFkZChmaWxlKVxuICAgICAgICAgIHJldHVyblxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGV4cG9ydHMgPSBleHBvcnRMaXN0LmdldChmaWxlKVxuXG4gICAgICAvLyBzcGVjaWFsIGNhc2U6IGV4cG9ydCAqIGZyb21cbiAgICAgIGNvbnN0IGV4cG9ydEFsbCA9IGV4cG9ydHMuZ2V0KEVYUE9SVF9BTExfREVDTEFSQVRJT04pXG4gICAgICBpZiAodHlwZW9mIGV4cG9ydEFsbCAhPT0gJ3VuZGVmaW5lZCcgJiYgZXhwb3J0ZWRWYWx1ZSAhPT0gSU1QT1JUX0RFRkFVTFRfU1BFQ0lGSUVSKSB7XG4gICAgICAgIGlmIChleHBvcnRBbGwud2hlcmVVc2VkLnNpemUgPiAwKSB7XG4gICAgICAgICAgcmV0dXJuXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgLy8gc3BlY2lhbCBjYXNlOiBuYW1lc3BhY2UgaW1wb3J0XG4gICAgICBjb25zdCBuYW1lc3BhY2VJbXBvcnRzID0gZXhwb3J0cy5nZXQoSU1QT1JUX05BTUVTUEFDRV9TUEVDSUZJRVIpXG4gICAgICBpZiAodHlwZW9mIG5hbWVzcGFjZUltcG9ydHMgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgICAgIGlmIChuYW1lc3BhY2VJbXBvcnRzLndoZXJlVXNlZC5zaXplID4gMCkge1xuICAgICAgICAgIHJldHVyblxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIC8vIGV4cG9ydHNMaXN0IHdpbGwgYWx3YXlzIG1hcCBhbnkgaW1wb3J0ZWQgdmFsdWUgb2YgJ2RlZmF1bHQnIHRvICdJbXBvcnREZWZhdWx0U3BlY2lmaWVyJ1xuICAgICAgY29uc3QgZXhwb3J0c0tleSA9IGV4cG9ydGVkVmFsdWUgPT09IERFRkFVTFQgPyBJTVBPUlRfREVGQVVMVF9TUEVDSUZJRVIgOiBleHBvcnRlZFZhbHVlXG5cbiAgICAgIGNvbnN0IGV4cG9ydFN0YXRlbWVudCA9IGV4cG9ydHMuZ2V0KGV4cG9ydHNLZXkpXG5cbiAgICAgIGNvbnN0IHZhbHVlID0gZXhwb3J0c0tleSA9PT0gSU1QT1JUX0RFRkFVTFRfU1BFQ0lGSUVSID8gREVGQVVMVCA6IGV4cG9ydHNLZXlcblxuICAgICAgaWYgKHR5cGVvZiBleHBvcnRTdGF0ZW1lbnQgIT09ICd1bmRlZmluZWQnKXtcbiAgICAgICAgaWYgKGV4cG9ydFN0YXRlbWVudC53aGVyZVVzZWQuc2l6ZSA8IDEpIHtcbiAgICAgICAgICBjb250ZXh0LnJlcG9ydChcbiAgICAgICAgICAgIG5vZGUsXG4gICAgICAgICAgICBgZXhwb3J0ZWQgZGVjbGFyYXRpb24gJyR7dmFsdWV9JyBub3QgdXNlZCB3aXRoaW4gb3RoZXIgbW9kdWxlc2BcbiAgICAgICAgICApXG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnRleHQucmVwb3J0KFxuICAgICAgICAgIG5vZGUsXG4gICAgICAgICAgYGV4cG9ydGVkIGRlY2xhcmF0aW9uICcke3ZhbHVlfScgbm90IHVzZWQgd2l0aGluIG90aGVyIG1vZHVsZXNgXG4gICAgICAgIClcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBvbmx5IHVzZWZ1bCBmb3IgdG9vbHMgbGlrZSB2c2NvZGUtZXNsaW50XG4gICAgICpcbiAgICAgKiB1cGRhdGUgbGlzdHMgb2YgZXhpc3RpbmcgZXhwb3J0cyBkdXJpbmcgcnVudGltZVxuICAgICAqL1xuICAgIGNvbnN0IHVwZGF0ZUV4cG9ydFVzYWdlID0gbm9kZSA9PiB7XG4gICAgICBpZiAoaWdub3JlZEZpbGVzLmhhcyhmaWxlKSkge1xuICAgICAgICByZXR1cm5cbiAgICAgIH1cblxuICAgICAgbGV0IGV4cG9ydHMgPSBleHBvcnRMaXN0LmdldChmaWxlKVxuXG4gICAgICAvLyBuZXcgbW9kdWxlIGhhcyBiZWVuIGNyZWF0ZWQgZHVyaW5nIHJ1bnRpbWVcbiAgICAgIC8vIGluY2x1ZGUgaXQgaW4gZnVydGhlciBwcm9jZXNzaW5nXG4gICAgICBpZiAodHlwZW9mIGV4cG9ydHMgPT09ICd1bmRlZmluZWQnKSB7XG4gICAgICAgIGV4cG9ydHMgPSBuZXcgTWFwKClcbiAgICAgIH1cblxuICAgICAgY29uc3QgbmV3RXhwb3J0cyA9IG5ldyBNYXAoKVxuICAgICAgY29uc3QgbmV3RXhwb3J0SWRlbnRpZmllcnMgPSBuZXcgU2V0KClcblxuICAgICAgbm9kZS5ib2R5LmZvckVhY2goKHsgdHlwZSwgZGVjbGFyYXRpb24sIHNwZWNpZmllcnMgfSkgPT4ge1xuICAgICAgICBpZiAodHlwZSA9PT0gRVhQT1JUX0RFRkFVTFRfREVDTEFSQVRJT04pIHtcbiAgICAgICAgICBuZXdFeHBvcnRJZGVudGlmaWVycy5hZGQoSU1QT1JUX0RFRkFVTFRfU1BFQ0lGSUVSKVxuICAgICAgICB9XG4gICAgICAgIGlmICh0eXBlID09PSBFWFBPUlRfTkFNRURfREVDTEFSQVRJT04pIHtcbiAgICAgICAgICBpZiAoc3BlY2lmaWVycy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICBzcGVjaWZpZXJzLmZvckVhY2goc3BlY2lmaWVyID0+IHtcbiAgICAgICAgICAgICAgaWYgKHNwZWNpZmllci5leHBvcnRlZCkge1xuICAgICAgICAgICAgICAgIG5ld0V4cG9ydElkZW50aWZpZXJzLmFkZChzcGVjaWZpZXIuZXhwb3J0ZWQubmFtZSlcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSlcbiAgICAgICAgICB9XG4gICAgICAgICAgZm9yRWFjaERlY2xhcmF0aW9uSWRlbnRpZmllcihkZWNsYXJhdGlvbiwgKG5hbWUpID0+IHtcbiAgICAgICAgICAgIG5ld0V4cG9ydElkZW50aWZpZXJzLmFkZChuYW1lKVxuICAgICAgICAgIH0pXG4gICAgICAgIH1cbiAgICAgIH0pXG5cbiAgICAgIC8vIG9sZCBleHBvcnRzIGV4aXN0IHdpdGhpbiBsaXN0IG9mIG5ldyBleHBvcnRzIGlkZW50aWZpZXJzOiBhZGQgdG8gbWFwIG9mIG5ldyBleHBvcnRzXG4gICAgICBleHBvcnRzLmZvckVhY2goKHZhbHVlLCBrZXkpID0+IHtcbiAgICAgICAgaWYgKG5ld0V4cG9ydElkZW50aWZpZXJzLmhhcyhrZXkpKSB7XG4gICAgICAgICAgbmV3RXhwb3J0cy5zZXQoa2V5LCB2YWx1ZSlcbiAgICAgICAgfVxuICAgICAgfSlcblxuICAgICAgLy8gbmV3IGV4cG9ydCBpZGVudGlmaWVycyBhZGRlZDogYWRkIHRvIG1hcCBvZiBuZXcgZXhwb3J0c1xuICAgICAgbmV3RXhwb3J0SWRlbnRpZmllcnMuZm9yRWFjaChrZXkgPT4ge1xuICAgICAgICBpZiAoIWV4cG9ydHMuaGFzKGtleSkpIHtcbiAgICAgICAgICBuZXdFeHBvcnRzLnNldChrZXksIHsgd2hlcmVVc2VkOiBuZXcgU2V0KCkgfSlcbiAgICAgICAgfVxuICAgICAgfSlcblxuICAgICAgLy8gcHJlc2VydmUgaW5mb3JtYXRpb24gYWJvdXQgbmFtZXNwYWNlIGltcG9ydHNcbiAgICAgIGxldCBleHBvcnRBbGwgPSBleHBvcnRzLmdldChFWFBPUlRfQUxMX0RFQ0xBUkFUSU9OKVxuICAgICAgbGV0IG5hbWVzcGFjZUltcG9ydHMgPSBleHBvcnRzLmdldChJTVBPUlRfTkFNRVNQQUNFX1NQRUNJRklFUilcblxuICAgICAgaWYgKHR5cGVvZiBuYW1lc3BhY2VJbXBvcnRzID09PSAndW5kZWZpbmVkJykge1xuICAgICAgICBuYW1lc3BhY2VJbXBvcnRzID0geyB3aGVyZVVzZWQ6IG5ldyBTZXQoKSB9XG4gICAgICB9XG5cbiAgICAgIG5ld0V4cG9ydHMuc2V0KEVYUE9SVF9BTExfREVDTEFSQVRJT04sIGV4cG9ydEFsbClcbiAgICAgIG5ld0V4cG9ydHMuc2V0KElNUE9SVF9OQU1FU1BBQ0VfU1BFQ0lGSUVSLCBuYW1lc3BhY2VJbXBvcnRzKVxuICAgICAgZXhwb3J0TGlzdC5zZXQoZmlsZSwgbmV3RXhwb3J0cylcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBvbmx5IHVzZWZ1bCBmb3IgdG9vbHMgbGlrZSB2c2NvZGUtZXNsaW50XG4gICAgICpcbiAgICAgKiB1cGRhdGUgbGlzdHMgb2YgZXhpc3RpbmcgaW1wb3J0cyBkdXJpbmcgcnVudGltZVxuICAgICAqL1xuICAgIGNvbnN0IHVwZGF0ZUltcG9ydFVzYWdlID0gbm9kZSA9PiB7XG4gICAgICBpZiAoIXVudXNlZEV4cG9ydHMpIHtcbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG5cbiAgICAgIGxldCBvbGRJbXBvcnRQYXRocyA9IGltcG9ydExpc3QuZ2V0KGZpbGUpXG4gICAgICBpZiAodHlwZW9mIG9sZEltcG9ydFBhdGhzID09PSAndW5kZWZpbmVkJykge1xuICAgICAgICBvbGRJbXBvcnRQYXRocyA9IG5ldyBNYXAoKVxuICAgICAgfVxuXG4gICAgICBjb25zdCBvbGROYW1lc3BhY2VJbXBvcnRzID0gbmV3IFNldCgpXG4gICAgICBjb25zdCBuZXdOYW1lc3BhY2VJbXBvcnRzID0gbmV3IFNldCgpXG5cbiAgICAgIGNvbnN0IG9sZEV4cG9ydEFsbCA9IG5ldyBTZXQoKVxuICAgICAgY29uc3QgbmV3RXhwb3J0QWxsID0gbmV3IFNldCgpXG5cbiAgICAgIGNvbnN0IG9sZERlZmF1bHRJbXBvcnRzID0gbmV3IFNldCgpXG4gICAgICBjb25zdCBuZXdEZWZhdWx0SW1wb3J0cyA9IG5ldyBTZXQoKVxuXG4gICAgICBjb25zdCBvbGRJbXBvcnRzID0gbmV3IE1hcCgpXG4gICAgICBjb25zdCBuZXdJbXBvcnRzID0gbmV3IE1hcCgpXG4gICAgICBvbGRJbXBvcnRQYXRocy5mb3JFYWNoKCh2YWx1ZSwga2V5KSA9PiB7XG4gICAgICAgIGlmICh2YWx1ZS5oYXMoRVhQT1JUX0FMTF9ERUNMQVJBVElPTikpIHtcbiAgICAgICAgICBvbGRFeHBvcnRBbGwuYWRkKGtleSlcbiAgICAgICAgfVxuICAgICAgICBpZiAodmFsdWUuaGFzKElNUE9SVF9OQU1FU1BBQ0VfU1BFQ0lGSUVSKSkge1xuICAgICAgICAgIG9sZE5hbWVzcGFjZUltcG9ydHMuYWRkKGtleSlcbiAgICAgICAgfVxuICAgICAgICBpZiAodmFsdWUuaGFzKElNUE9SVF9ERUZBVUxUX1NQRUNJRklFUikpIHtcbiAgICAgICAgICBvbGREZWZhdWx0SW1wb3J0cy5hZGQoa2V5KVxuICAgICAgICB9XG4gICAgICAgIHZhbHVlLmZvckVhY2godmFsID0+IHtcbiAgICAgICAgICBpZiAodmFsICE9PSBJTVBPUlRfTkFNRVNQQUNFX1NQRUNJRklFUiAmJlxuICAgICAgICAgICAgICB2YWwgIT09IElNUE9SVF9ERUZBVUxUX1NQRUNJRklFUikge1xuICAgICAgICAgICAgICAgb2xkSW1wb3J0cy5zZXQodmFsLCBrZXkpXG4gICAgICAgICAgICAgfVxuICAgICAgICB9KVxuICAgICAgfSlcblxuICAgICAgbm9kZS5ib2R5LmZvckVhY2goYXN0Tm9kZSA9PiB7XG4gICAgICAgIGxldCByZXNvbHZlZFBhdGhcblxuICAgICAgICAvLyBzdXBwb3J0IGZvciBleHBvcnQgeyB2YWx1ZSB9IGZyb20gJ21vZHVsZSdcbiAgICAgICAgaWYgKGFzdE5vZGUudHlwZSA9PT0gRVhQT1JUX05BTUVEX0RFQ0xBUkFUSU9OKSB7XG4gICAgICAgICAgaWYgKGFzdE5vZGUuc291cmNlKSB7XG4gICAgICAgICAgICByZXNvbHZlZFBhdGggPSByZXNvbHZlKGFzdE5vZGUuc291cmNlLnJhdy5yZXBsYWNlKC8oJ3xcIikvZywgJycpLCBjb250ZXh0KVxuICAgICAgICAgICAgYXN0Tm9kZS5zcGVjaWZpZXJzLmZvckVhY2goc3BlY2lmaWVyID0+IHtcbiAgICAgICAgICAgICAgY29uc3QgbmFtZSA9IHNwZWNpZmllci5sb2NhbC5uYW1lXG4gICAgICAgICAgICAgIGlmIChzcGVjaWZpZXIubG9jYWwubmFtZSA9PT0gREVGQVVMVCkge1xuICAgICAgICAgICAgICAgIG5ld0RlZmF1bHRJbXBvcnRzLmFkZChyZXNvbHZlZFBhdGgpXG4gICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgbmV3SW1wb3J0cy5zZXQobmFtZSwgcmVzb2x2ZWRQYXRoKVxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChhc3ROb2RlLnR5cGUgPT09IEVYUE9SVF9BTExfREVDTEFSQVRJT04pIHtcbiAgICAgICAgICByZXNvbHZlZFBhdGggPSByZXNvbHZlKGFzdE5vZGUuc291cmNlLnJhdy5yZXBsYWNlKC8oJ3xcIikvZywgJycpLCBjb250ZXh0KVxuICAgICAgICAgIG5ld0V4cG9ydEFsbC5hZGQocmVzb2x2ZWRQYXRoKVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGFzdE5vZGUudHlwZSA9PT0gSU1QT1JUX0RFQ0xBUkFUSU9OKSB7XG4gICAgICAgICAgcmVzb2x2ZWRQYXRoID0gcmVzb2x2ZShhc3ROb2RlLnNvdXJjZS5yYXcucmVwbGFjZSgvKCd8XCIpL2csICcnKSwgY29udGV4dClcbiAgICAgICAgICBpZiAoIXJlc29sdmVkUGF0aCkge1xuICAgICAgICAgICAgcmV0dXJuXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKGlzTm9kZU1vZHVsZShyZXNvbHZlZFBhdGgpKSB7XG4gICAgICAgICAgICByZXR1cm5cbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAobmV3TmFtZXNwYWNlSW1wb3J0RXhpc3RzKGFzdE5vZGUuc3BlY2lmaWVycykpIHtcbiAgICAgICAgICAgIG5ld05hbWVzcGFjZUltcG9ydHMuYWRkKHJlc29sdmVkUGF0aClcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAobmV3RGVmYXVsdEltcG9ydEV4aXN0cyhhc3ROb2RlLnNwZWNpZmllcnMpKSB7XG4gICAgICAgICAgICBuZXdEZWZhdWx0SW1wb3J0cy5hZGQocmVzb2x2ZWRQYXRoKVxuICAgICAgICAgIH1cblxuICAgICAgICAgIGFzdE5vZGUuc3BlY2lmaWVycy5mb3JFYWNoKHNwZWNpZmllciA9PiB7XG4gICAgICAgICAgICBpZiAoc3BlY2lmaWVyLnR5cGUgPT09IElNUE9SVF9ERUZBVUxUX1NQRUNJRklFUiB8fFxuICAgICAgICAgICAgICAgIHNwZWNpZmllci50eXBlID09PSBJTVBPUlRfTkFNRVNQQUNFX1NQRUNJRklFUikge1xuICAgICAgICAgICAgICByZXR1cm5cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIG5ld0ltcG9ydHMuc2V0KHNwZWNpZmllci5pbXBvcnRlZC5uYW1lLCByZXNvbHZlZFBhdGgpXG4gICAgICAgICAgfSlcbiAgICAgICAgfVxuICAgICAgfSlcblxuICAgICAgbmV3RXhwb3J0QWxsLmZvckVhY2godmFsdWUgPT4ge1xuICAgICAgICBpZiAoIW9sZEV4cG9ydEFsbC5oYXModmFsdWUpKSB7XG4gICAgICAgICAgbGV0IGltcG9ydHMgPSBvbGRJbXBvcnRQYXRocy5nZXQodmFsdWUpXG4gICAgICAgICAgaWYgKHR5cGVvZiBpbXBvcnRzID09PSAndW5kZWZpbmVkJykge1xuICAgICAgICAgICAgaW1wb3J0cyA9IG5ldyBTZXQoKVxuICAgICAgICAgIH1cbiAgICAgICAgICBpbXBvcnRzLmFkZChFWFBPUlRfQUxMX0RFQ0xBUkFUSU9OKVxuICAgICAgICAgIG9sZEltcG9ydFBhdGhzLnNldCh2YWx1ZSwgaW1wb3J0cylcblxuICAgICAgICAgIGxldCBleHBvcnRzID0gZXhwb3J0TGlzdC5nZXQodmFsdWUpXG4gICAgICAgICAgbGV0IGN1cnJlbnRFeHBvcnRcbiAgICAgICAgICBpZiAodHlwZW9mIGV4cG9ydHMgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgICAgICAgICBjdXJyZW50RXhwb3J0ID0gZXhwb3J0cy5nZXQoRVhQT1JUX0FMTF9ERUNMQVJBVElPTilcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgZXhwb3J0cyA9IG5ldyBNYXAoKVxuICAgICAgICAgICAgZXhwb3J0TGlzdC5zZXQodmFsdWUsIGV4cG9ydHMpXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKHR5cGVvZiBjdXJyZW50RXhwb3J0ICE9PSAndW5kZWZpbmVkJykge1xuICAgICAgICAgICAgY3VycmVudEV4cG9ydC53aGVyZVVzZWQuYWRkKGZpbGUpXG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGNvbnN0IHdoZXJlVXNlZCA9IG5ldyBTZXQoKVxuICAgICAgICAgICAgd2hlcmVVc2VkLmFkZChmaWxlKVxuICAgICAgICAgICAgZXhwb3J0cy5zZXQoRVhQT1JUX0FMTF9ERUNMQVJBVElPTiwgeyB3aGVyZVVzZWQgfSlcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0pXG5cbiAgICAgIG9sZEV4cG9ydEFsbC5mb3JFYWNoKHZhbHVlID0+IHtcbiAgICAgICAgaWYgKCFuZXdFeHBvcnRBbGwuaGFzKHZhbHVlKSkge1xuICAgICAgICAgIGNvbnN0IGltcG9ydHMgPSBvbGRJbXBvcnRQYXRocy5nZXQodmFsdWUpXG4gICAgICAgICAgaW1wb3J0cy5kZWxldGUoRVhQT1JUX0FMTF9ERUNMQVJBVElPTilcblxuICAgICAgICAgIGNvbnN0IGV4cG9ydHMgPSBleHBvcnRMaXN0LmdldCh2YWx1ZSlcbiAgICAgICAgICBpZiAodHlwZW9mIGV4cG9ydHMgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgICAgICAgICBjb25zdCBjdXJyZW50RXhwb3J0ID0gZXhwb3J0cy5nZXQoRVhQT1JUX0FMTF9ERUNMQVJBVElPTilcbiAgICAgICAgICAgIGlmICh0eXBlb2YgY3VycmVudEV4cG9ydCAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgICAgICAgICAgY3VycmVudEV4cG9ydC53aGVyZVVzZWQuZGVsZXRlKGZpbGUpXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KVxuXG4gICAgICBuZXdEZWZhdWx0SW1wb3J0cy5mb3JFYWNoKHZhbHVlID0+IHtcbiAgICAgICAgaWYgKCFvbGREZWZhdWx0SW1wb3J0cy5oYXModmFsdWUpKSB7XG4gICAgICAgICAgbGV0IGltcG9ydHMgPSBvbGRJbXBvcnRQYXRocy5nZXQodmFsdWUpXG4gICAgICAgICAgaWYgKHR5cGVvZiBpbXBvcnRzID09PSAndW5kZWZpbmVkJykge1xuICAgICAgICAgICAgaW1wb3J0cyA9IG5ldyBTZXQoKVxuICAgICAgICAgIH1cbiAgICAgICAgICBpbXBvcnRzLmFkZChJTVBPUlRfREVGQVVMVF9TUEVDSUZJRVIpXG4gICAgICAgICAgb2xkSW1wb3J0UGF0aHMuc2V0KHZhbHVlLCBpbXBvcnRzKVxuXG4gICAgICAgICAgbGV0IGV4cG9ydHMgPSBleHBvcnRMaXN0LmdldCh2YWx1ZSlcbiAgICAgICAgICBsZXQgY3VycmVudEV4cG9ydFxuICAgICAgICAgIGlmICh0eXBlb2YgZXhwb3J0cyAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgICAgICAgIGN1cnJlbnRFeHBvcnQgPSBleHBvcnRzLmdldChJTVBPUlRfREVGQVVMVF9TUEVDSUZJRVIpXG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGV4cG9ydHMgPSBuZXcgTWFwKClcbiAgICAgICAgICAgIGV4cG9ydExpc3Quc2V0KHZhbHVlLCBleHBvcnRzKVxuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmICh0eXBlb2YgY3VycmVudEV4cG9ydCAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgICAgICAgIGN1cnJlbnRFeHBvcnQud2hlcmVVc2VkLmFkZChmaWxlKVxuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjb25zdCB3aGVyZVVzZWQgPSBuZXcgU2V0KClcbiAgICAgICAgICAgIHdoZXJlVXNlZC5hZGQoZmlsZSlcbiAgICAgICAgICAgIGV4cG9ydHMuc2V0KElNUE9SVF9ERUZBVUxUX1NQRUNJRklFUiwgeyB3aGVyZVVzZWQgfSlcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0pXG5cbiAgICAgIG9sZERlZmF1bHRJbXBvcnRzLmZvckVhY2godmFsdWUgPT4ge1xuICAgICAgICBpZiAoIW5ld0RlZmF1bHRJbXBvcnRzLmhhcyh2YWx1ZSkpIHtcbiAgICAgICAgICBjb25zdCBpbXBvcnRzID0gb2xkSW1wb3J0UGF0aHMuZ2V0KHZhbHVlKVxuICAgICAgICAgIGltcG9ydHMuZGVsZXRlKElNUE9SVF9ERUZBVUxUX1NQRUNJRklFUilcblxuICAgICAgICAgIGNvbnN0IGV4cG9ydHMgPSBleHBvcnRMaXN0LmdldCh2YWx1ZSlcbiAgICAgICAgICBpZiAodHlwZW9mIGV4cG9ydHMgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgICAgICAgICBjb25zdCBjdXJyZW50RXhwb3J0ID0gZXhwb3J0cy5nZXQoSU1QT1JUX0RFRkFVTFRfU1BFQ0lGSUVSKVxuICAgICAgICAgICAgaWYgKHR5cGVvZiBjdXJyZW50RXhwb3J0ICE9PSAndW5kZWZpbmVkJykge1xuICAgICAgICAgICAgICBjdXJyZW50RXhwb3J0LndoZXJlVXNlZC5kZWxldGUoZmlsZSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0pXG5cbiAgICAgIG5ld05hbWVzcGFjZUltcG9ydHMuZm9yRWFjaCh2YWx1ZSA9PiB7XG4gICAgICAgIGlmICghb2xkTmFtZXNwYWNlSW1wb3J0cy5oYXModmFsdWUpKSB7XG4gICAgICAgICAgbGV0IGltcG9ydHMgPSBvbGRJbXBvcnRQYXRocy5nZXQodmFsdWUpXG4gICAgICAgICAgaWYgKHR5cGVvZiBpbXBvcnRzID09PSAndW5kZWZpbmVkJykge1xuICAgICAgICAgICAgaW1wb3J0cyA9IG5ldyBTZXQoKVxuICAgICAgICAgIH1cbiAgICAgICAgICBpbXBvcnRzLmFkZChJTVBPUlRfTkFNRVNQQUNFX1NQRUNJRklFUilcbiAgICAgICAgICBvbGRJbXBvcnRQYXRocy5zZXQodmFsdWUsIGltcG9ydHMpXG5cbiAgICAgICAgICBsZXQgZXhwb3J0cyA9IGV4cG9ydExpc3QuZ2V0KHZhbHVlKVxuICAgICAgICAgIGxldCBjdXJyZW50RXhwb3J0XG4gICAgICAgICAgaWYgKHR5cGVvZiBleHBvcnRzICE9PSAndW5kZWZpbmVkJykge1xuICAgICAgICAgICAgY3VycmVudEV4cG9ydCA9IGV4cG9ydHMuZ2V0KElNUE9SVF9OQU1FU1BBQ0VfU1BFQ0lGSUVSKVxuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBleHBvcnRzID0gbmV3IE1hcCgpXG4gICAgICAgICAgICBleHBvcnRMaXN0LnNldCh2YWx1ZSwgZXhwb3J0cylcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAodHlwZW9mIGN1cnJlbnRFeHBvcnQgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgICAgICAgICBjdXJyZW50RXhwb3J0LndoZXJlVXNlZC5hZGQoZmlsZSlcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY29uc3Qgd2hlcmVVc2VkID0gbmV3IFNldCgpXG4gICAgICAgICAgICB3aGVyZVVzZWQuYWRkKGZpbGUpXG4gICAgICAgICAgICBleHBvcnRzLnNldChJTVBPUlRfTkFNRVNQQUNFX1NQRUNJRklFUiwgeyB3aGVyZVVzZWQgfSlcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0pXG5cbiAgICAgIG9sZE5hbWVzcGFjZUltcG9ydHMuZm9yRWFjaCh2YWx1ZSA9PiB7XG4gICAgICAgIGlmICghbmV3TmFtZXNwYWNlSW1wb3J0cy5oYXModmFsdWUpKSB7XG4gICAgICAgICAgY29uc3QgaW1wb3J0cyA9IG9sZEltcG9ydFBhdGhzLmdldCh2YWx1ZSlcbiAgICAgICAgICBpbXBvcnRzLmRlbGV0ZShJTVBPUlRfTkFNRVNQQUNFX1NQRUNJRklFUilcblxuICAgICAgICAgIGNvbnN0IGV4cG9ydHMgPSBleHBvcnRMaXN0LmdldCh2YWx1ZSlcbiAgICAgICAgICBpZiAodHlwZW9mIGV4cG9ydHMgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgICAgICAgICBjb25zdCBjdXJyZW50RXhwb3J0ID0gZXhwb3J0cy5nZXQoSU1QT1JUX05BTUVTUEFDRV9TUEVDSUZJRVIpXG4gICAgICAgICAgICBpZiAodHlwZW9mIGN1cnJlbnRFeHBvcnQgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgICAgICAgICAgIGN1cnJlbnRFeHBvcnQud2hlcmVVc2VkLmRlbGV0ZShmaWxlKVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSlcblxuICAgICAgbmV3SW1wb3J0cy5mb3JFYWNoKCh2YWx1ZSwga2V5KSA9PiB7XG4gICAgICAgIGlmICghb2xkSW1wb3J0cy5oYXMoa2V5KSkge1xuICAgICAgICAgIGxldCBpbXBvcnRzID0gb2xkSW1wb3J0UGF0aHMuZ2V0KHZhbHVlKVxuICAgICAgICAgIGlmICh0eXBlb2YgaW1wb3J0cyA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgICAgICAgIGltcG9ydHMgPSBuZXcgU2V0KClcbiAgICAgICAgICB9XG4gICAgICAgICAgaW1wb3J0cy5hZGQoa2V5KVxuICAgICAgICAgIG9sZEltcG9ydFBhdGhzLnNldCh2YWx1ZSwgaW1wb3J0cylcblxuICAgICAgICAgIGxldCBleHBvcnRzID0gZXhwb3J0TGlzdC5nZXQodmFsdWUpXG4gICAgICAgICAgbGV0IGN1cnJlbnRFeHBvcnRcbiAgICAgICAgICBpZiAodHlwZW9mIGV4cG9ydHMgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgICAgICAgICBjdXJyZW50RXhwb3J0ID0gZXhwb3J0cy5nZXQoa2V5KVxuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBleHBvcnRzID0gbmV3IE1hcCgpXG4gICAgICAgICAgICBleHBvcnRMaXN0LnNldCh2YWx1ZSwgZXhwb3J0cylcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAodHlwZW9mIGN1cnJlbnRFeHBvcnQgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgICAgICAgICBjdXJyZW50RXhwb3J0LndoZXJlVXNlZC5hZGQoZmlsZSlcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY29uc3Qgd2hlcmVVc2VkID0gbmV3IFNldCgpXG4gICAgICAgICAgICB3aGVyZVVzZWQuYWRkKGZpbGUpXG4gICAgICAgICAgICBleHBvcnRzLnNldChrZXksIHsgd2hlcmVVc2VkIH0pXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KVxuXG4gICAgICBvbGRJbXBvcnRzLmZvckVhY2goKHZhbHVlLCBrZXkpID0+IHtcbiAgICAgICAgaWYgKCFuZXdJbXBvcnRzLmhhcyhrZXkpKSB7XG4gICAgICAgICAgY29uc3QgaW1wb3J0cyA9IG9sZEltcG9ydFBhdGhzLmdldCh2YWx1ZSlcbiAgICAgICAgICBpbXBvcnRzLmRlbGV0ZShrZXkpXG5cbiAgICAgICAgICBjb25zdCBleHBvcnRzID0gZXhwb3J0TGlzdC5nZXQodmFsdWUpXG4gICAgICAgICAgaWYgKHR5cGVvZiBleHBvcnRzICE9PSAndW5kZWZpbmVkJykge1xuICAgICAgICAgICAgY29uc3QgY3VycmVudEV4cG9ydCA9IGV4cG9ydHMuZ2V0KGtleSlcbiAgICAgICAgICAgIGlmICh0eXBlb2YgY3VycmVudEV4cG9ydCAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgICAgICAgICAgY3VycmVudEV4cG9ydC53aGVyZVVzZWQuZGVsZXRlKGZpbGUpXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KVxuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICAnUHJvZ3JhbTpleGl0Jzogbm9kZSA9PiB7XG4gICAgICAgIHVwZGF0ZUV4cG9ydFVzYWdlKG5vZGUpXG4gICAgICAgIHVwZGF0ZUltcG9ydFVzYWdlKG5vZGUpXG4gICAgICAgIGNoZWNrRXhwb3J0UHJlc2VuY2Uobm9kZSlcbiAgICAgIH0sXG4gICAgICAnRXhwb3J0RGVmYXVsdERlY2xhcmF0aW9uJzogbm9kZSA9PiB7XG4gICAgICAgIGNoZWNrVXNhZ2Uobm9kZSwgSU1QT1JUX0RFRkFVTFRfU1BFQ0lGSUVSKVxuICAgICAgfSxcbiAgICAgICdFeHBvcnROYW1lZERlY2xhcmF0aW9uJzogbm9kZSA9PiB7XG4gICAgICAgIG5vZGUuc3BlY2lmaWVycy5mb3JFYWNoKHNwZWNpZmllciA9PiB7XG4gICAgICAgICAgICBjaGVja1VzYWdlKG5vZGUsIHNwZWNpZmllci5leHBvcnRlZC5uYW1lKVxuICAgICAgICB9KVxuICAgICAgICBmb3JFYWNoRGVjbGFyYXRpb25JZGVudGlmaWVyKG5vZGUuZGVjbGFyYXRpb24sIChuYW1lKSA9PiB7XG4gICAgICAgICAgY2hlY2tVc2FnZShub2RlLCBuYW1lKVxuICAgICAgICB9KVxuICAgICAgfSxcbiAgICB9XG4gIH0sXG59XG4iXX0=