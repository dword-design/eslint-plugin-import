'use strict';var _slicedToArray = function () {function sliceIterator(arr, i) {var _arr = [];var _n = true;var _d = false;var _e = undefined;try {for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) {_arr.push(_s.value);if (i && _arr.length === i) break;}} catch (err) {_d = true;_e = err;} finally {try {if (!_n && _i["return"]) _i["return"]();} finally {if (_d) throw _e;}}return _arr;}return function (arr, i) {if (Array.isArray(arr)) {return arr;} else if (Symbol.iterator in Object(arr)) {return sliceIterator(arr, i);} else {throw new TypeError("Invalid attempt to destructure non-iterable instance");}};}();var _ExportMap = require('../ExportMap');var _ExportMap2 = _interopRequireDefault(_ExportMap);
var _docsUrl = require('../docsUrl');var _docsUrl2 = _interopRequireDefault(_docsUrl);
var _arrayIncludes = require('array-includes');var _arrayIncludes2 = _interopRequireDefault(_arrayIncludes);function _interopRequireDefault(obj) {return obj && obj.__esModule ? obj : { default: obj };}

/*
                                                                                                                                                                                                          Notes on TypeScript namespaces aka TSModuleDeclaration:
                                                                                                                                                                                                          
                                                                                                                                                                                                          There are two forms:
                                                                                                                                                                                                          - active namespaces: namespace Foo {} / module Foo {}
                                                                                                                                                                                                          - ambient modules; declare module "eslint-plugin-import" {}
                                                                                                                                                                                                          
                                                                                                                                                                                                          active namespaces:
                                                                                                                                                                                                          - cannot contain a default export
                                                                                                                                                                                                          - cannot contain an export all
                                                                                                                                                                                                          - cannot contain a multi name export (export { a, b })
                                                                                                                                                                                                          - can have active namespaces nested within them
                                                                                                                                                                                                          
                                                                                                                                                                                                          ambient namespaces:
                                                                                                                                                                                                          - can only be defined in .d.ts files
                                                                                                                                                                                                          - cannot be nested within active namespaces
                                                                                                                                                                                                          - have no other restrictions
                                                                                                                                                                                                          */

const rootProgram = 'root';
const tsTypePrefix = 'type:';

/**
                               * Detect function overloads like:
                               * ```ts
                               * export function foo(a: number);
                               * export function foo(a: string);
                               * export function foo(a: number|string) { return a; }
                               * ```
                               * @param {Set<Object>} nodes
                               * @returns {boolean}
                               */
function isTypescriptFunctionOverloads(nodes) {
  const types = new Set(Array.from(nodes, node => node.parent.type));
  return (
    types.has('TSDeclareFunction') && (

    types.size === 1 ||
    types.size === 2 && types.has('FunctionDeclaration')));


}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      url: (0, _docsUrl2.default)('export') },

    schema: [] },


  create: function (context) {
    const namespace = new Map([[rootProgram, new Map()]]);

    function addNamed(name, node, parent, isType) {
      if (!namespace.has(parent)) {
        namespace.set(parent, new Map());
      }
      const named = namespace.get(parent);

      const key = isType ? `${tsTypePrefix}${name}` : name;
      let nodes = named.get(key);

      if (nodes == null) {
        nodes = new Set();
        named.set(key, nodes);
      }

      nodes.add(node);
    }

    function getParent(node) {
      if (node.parent && node.parent.type === 'TSModuleBlock') {
        return node.parent.parent;
      }

      // just in case somehow a non-ts namespace export declaration isn't directly
      // parented to the root Program node
      return rootProgram;
    }

    return {
      'ExportDefaultDeclaration': node => addNamed('default', node, getParent(node)),

      'ExportSpecifier': node => addNamed(
      node.exported.name,
      node.exported,
      getParent(node.parent)),


      'ExportNamedDeclaration': function (node) {
        if (node.declaration == null) return;

        const parent = getParent(node);
        // support for old TypeScript versions
        const isTypeVariableDecl = node.declaration.kind === 'type';

        if (node.declaration.id != null) {
          if ((0, _arrayIncludes2.default)([
          'TSTypeAliasDeclaration',
          'TSInterfaceDeclaration'],
          node.declaration.type)) {
            addNamed(node.declaration.id.name, node.declaration.id, parent, true);
          } else {
            addNamed(node.declaration.id.name, node.declaration.id, parent, isTypeVariableDecl);
          }
        }

        if (node.declaration.declarations != null) {
          for (let declaration of node.declaration.declarations) {
            (0, _ExportMap.recursivePatternCapture)(declaration.id, v =>
            addNamed(v.name, v, parent, isTypeVariableDecl));
          }
        }
      },

      'ExportAllDeclaration': function (node) {
        if (node.source == null) return; // not sure if this is ever true

        // `export * as X from 'path'` does not conflict
        if (node.exported && node.exported.name) return;

        const remoteExports = _ExportMap2.default.get(node.source.value, context);
        if (remoteExports == null) return;

        if (remoteExports.errors.length) {
          remoteExports.reportErrors(context, node);
          return;
        }

        const parent = getParent(node);

        let any = false;
        remoteExports.forEach((v, name) =>
        name !== 'default' && (
        any = true) && // poor man's filter
        addNamed(name, node, parent));

        if (!any) {
          context.report(
          node.source,
          `No named exports found in module '${node.source.value}'.`);

        }
      },

      'Program:exit': function () {
        for (let _ref of namespace) {var _ref2 = _slicedToArray(_ref, 2);let named = _ref2[1];
          for (let _ref3 of named) {var _ref4 = _slicedToArray(_ref3, 2);let name = _ref4[0];let nodes = _ref4[1];
            if (nodes.size <= 1) continue;

            if (isTypescriptFunctionOverloads(nodes)) continue;

            for (let node of nodes) {
              if (name === 'default') {
                context.report(node, 'Multiple default exports.');
              } else {
                context.report(
                node,
                `Multiple exports of name '${name.replace(tsTypePrefix, '')}'.`);

              }
            }
          }
        }
      } };

  } };
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9ydWxlcy9leHBvcnQuanMiXSwibmFtZXMiOlsicm9vdFByb2dyYW0iLCJ0c1R5cGVQcmVmaXgiLCJpc1R5cGVzY3JpcHRGdW5jdGlvbk92ZXJsb2FkcyIsIm5vZGVzIiwidHlwZXMiLCJTZXQiLCJBcnJheSIsImZyb20iLCJub2RlIiwicGFyZW50IiwidHlwZSIsImhhcyIsInNpemUiLCJtb2R1bGUiLCJleHBvcnRzIiwibWV0YSIsImRvY3MiLCJ1cmwiLCJzY2hlbWEiLCJjcmVhdGUiLCJjb250ZXh0IiwibmFtZXNwYWNlIiwiTWFwIiwiYWRkTmFtZWQiLCJuYW1lIiwiaXNUeXBlIiwic2V0IiwibmFtZWQiLCJnZXQiLCJrZXkiLCJhZGQiLCJnZXRQYXJlbnQiLCJleHBvcnRlZCIsImRlY2xhcmF0aW9uIiwiaXNUeXBlVmFyaWFibGVEZWNsIiwia2luZCIsImlkIiwiZGVjbGFyYXRpb25zIiwidiIsInNvdXJjZSIsInJlbW90ZUV4cG9ydHMiLCJFeHBvcnRNYXAiLCJ2YWx1ZSIsImVycm9ycyIsImxlbmd0aCIsInJlcG9ydEVycm9ycyIsImFueSIsImZvckVhY2giLCJyZXBvcnQiLCJyZXBsYWNlIl0sIm1hcHBpbmdzIjoicW9CQUFBLHlDO0FBQ0EscUM7QUFDQSwrQzs7QUFFQTs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQW1CQSxNQUFNQSxjQUFjLE1BQXBCO0FBQ0EsTUFBTUMsZUFBZSxPQUFyQjs7QUFFQTs7Ozs7Ozs7OztBQVVBLFNBQVNDLDZCQUFULENBQXVDQyxLQUF2QyxFQUE4QztBQUM1QyxRQUFNQyxRQUFRLElBQUlDLEdBQUosQ0FBUUMsTUFBTUMsSUFBTixDQUFXSixLQUFYLEVBQWtCSyxRQUFRQSxLQUFLQyxNQUFMLENBQVlDLElBQXRDLENBQVIsQ0FBZDtBQUNBO0FBQ0VOLFVBQU1PLEdBQU4sQ0FBVSxtQkFBVjs7QUFFRVAsVUFBTVEsSUFBTixLQUFlLENBQWY7QUFDQ1IsVUFBTVEsSUFBTixLQUFlLENBQWYsSUFBb0JSLE1B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QUMvQiw0QkFBMEJBLEtBQTFCLEVBQWlDLDBDQUF2QkgsSUFBdUIsZ0JBQWpCckIsS0FBaUI7QUFDL0IsZ0JBQUlBLE1BQU1TLElBQU4sSUFBYyxDQUFsQixFQUFxQjs7QUFFckIsZ0JBQUlWLDhCQUE4QkMsS0FBOUIsQ0FBSixFQUEwQzs7QUFFMUMsaUJBQUssSUFBSUssSUFBVCxJQUFpQkwsS0FBakIsRUFBd0I7QUFDdEIsa0JBQUlxQixTQUFTLFNBQWIsRUFBd0I7QUFDdEJKLHdCQUFRNEIsTUFBUixDQUFleEMsSUFBZixFQUFxQiwyQkFBckI7QUFDRCxlQUZELE1BRU87QUFDTFksd0JBQVE0QixNQUFSO0FBQ0V4QyxvQkFERjtBQUVHLDZDQUE0QmdCLEtBQUt5QixPQUFMLENBQWFoRCxZQUFiLEVBQTJCLEVBQTNCLENBQStCLElBRjlEOztBQUlEO0FBQ0Y7QUFDRjtBQUNGO0FBQ0YsT0FwRkksRUFBUDs7QUFzRkQsR0E3SGMsRUFBakIiLCJmaWxlIjoiZXhwb3J0LmpzIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IEV4cG9ydE1hcCwgeyByZWN1cnNpdmVQYXR0ZXJuQ2FwdHVyZSB9IGZyb20gJy4uL0V4cG9ydE1hcCdcbmltcG9ydCBkb2NzVXJsIGZyb20gJy4uL2RvY3NVcmwnXG5pbXBvcnQgaW5jbHVkZXMgZnJvbSAnYXJyYXktaW5jbHVkZXMnXG5cbi8qXG5Ob3RlcyBvbiBUeXBlU2NyaXB0IG5hbWVzcGFjZXMgYWthIFRTTW9kdWxlRGVjbGFyYXRpb246XG5cblRoZXJlIGFyZSB0d28gZm9ybXM6XG4tIGFjdGl2ZSBuYW1lc3BhY2VzOiBuYW1lc3BhY2UgRm9vIHt9IC8gbW9kdWxlIEZvbyB7fVxuLSBhbWJpZW50IG1vZHVsZXM7IGRlY2xhcmUgbW9kdWxlIFwiZXNsaW50LXBsdWdpbi1pbXBvcnRcIiB7fVxuXG5hY3RpdmUgbmFtZXNwYWNlczpcbi0gY2Fubm90IGNvbnRhaW4gYSBkZWZhdWx0IGV4cG9ydFxuLSBjYW5ub3QgY29udGFpbiBhbiBleHBvcnQgYWxsXG4tIGNhbm5vdCBjb250YWluIGEgbXVsdGkgbmFtZSBleHBvcnQgKGV4cG9ydCB7IGEsIGIgfSlcbi0gY2FuIGhhdmUgYWN0aXZlIG5hbWVzcGFjZXMgbmVzdGVkIHdpdGhpbiB0aGVtXG5cbmFtYmllbnQgbmFtZXNwYWNlczpcbi0gY2FuIG9ubHkgYmUgZGVmaW5lZCBpbiAuZC50cyBmaWxlc1xuLSBjYW5ub3QgYmUgbmVzdGVkIHdpdGhpbiBhY3RpdmUgbmFtZXNwYWNlc1xuLSBoYXZlIG5vIG90aGVyIHJlc3RyaWN0aW9uc1xuKi9cblxuY29uc3Qgcm9vdFByb2dyYW0gPSAncm9vdCdcbmNvbnN0IHRzVHlwZVByZWZpeCA9ICd0eXBlOidcblxuLyoqXG4gKiBEZXRlY3QgZnVuY3Rpb24gb3ZlcmxvYWRzIGxpa2U6XG4gKiBgYGB0c1xuICogZXhwb3J0IGZ1bmN0aW9uIGZvbyhhOiBudW1iZXIpO1xuICogZXhwb3J0IGZ1bmN0aW9uIGZvbyhhOiBzdHJpbmcpO1xuICogZXhwb3J0IGZ1bmN0aW9uIGZvbyhhOiBudW1iZXJ8c3RyaW5nKSB7IHJldHVybiBhOyB9XG4gKiBgYGBcbiAqIEBwYXJhbSB7U2V0PE9iamVjdD59IG5vZGVzXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn1cbiAqL1xuZnVuY3Rpb24gaXNUeXBlc2NyaXB0RnVuY3Rpb25PdmVybG9hZHMobm9kZXMpIHtcbiAgY29uc3QgdHlwZXMgPSBuZXcgU2V0KEFycmF5LmZyb20obm9kZXMsIG5vZGUgPT4gbm9kZS5wYXJlbnQudHlwZSkpXG4gIHJldHVybiAoXG4gICAgdHlwZXMuaGFzKCdUU0RlY2xhcmVGdW5jdGlvbicpICYmXG4gICAgKFxuICAgICAgdHlwZXMuc2l6ZSA9PT0gMSB8fFxuICAgICAgKHR5cGVzLnNpemUgPT09IDIgJiYgdHlwZXMuaGFzKCdGdW5jdGlvbkRlY2xhcmF0aW9uJykpXG4gICAgKVxuICApXG59XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICBtZXRhOiB7XG4gICAgdHlwZTogJ3Byb2JsZW0nLFxuICAgIGRvY3M6IHtcbiAgICAgIHVybDogZG9jc1VybCgnZXhwb3J0JyksXG4gICAgfSxcbiAgICBzY2hlbWE6IFtdLFxuICB9LFxuXG4gIGNyZWF0ZTogZnVuY3Rpb24gKGNvbnRleHQpIHtcbiAgICBjb25zdCBuYW1lc3BhY2UgPSBuZXcgTWFwKFtbcm9vdFByb2dyYW0sIG5ldyBNYXAoKV1dKVxuXG4gICAgZnVuY3Rpb24gYWRkTmFtZWQobmFtZSwgbm9kZSwgcGFyZW50LCBpc1R5cGUpIHtcbiAgICAgIGlmICghbmFtZXNwYWNlLmhhcyhwYXJlbnQpKSB7XG4gICAgICAgIG5hbWVzcGFjZS5zZXQocGFyZW50LCBuZXcgTWFwKCkpXG4gICAgICB9XG4gICAgICBjb25zdCBuYW1lZCA9IG5hbWVzcGFjZS5nZXQocGFyZW50KVxuXG4gICAgICBjb25zdCBrZXkgPSBpc1R5cGUgPyBgJHt0c1R5cGVQcmVmaXh9JHtuYW1lfWAgOiBuYW1lXG4gICAgICBsZXQgbm9kZXMgPSBuYW1lZC5nZXQoa2V5KVxuXG4gICAgICBpZiAobm9kZXMgPT0gbnVsbCkge1xuICAgICAgICBub2RlcyA9IG5ldyBTZXQoKVxuICAgICAgICBuYW1lZC5zZXQoa2V5LCBub2RlcylcbiAgICAgIH1cblxuICAgICAgbm9kZXMuYWRkKG5vZGUpXG4gICAgfVxuXG4gICAgZnVuY3Rpb24gZ2V0UGFyZW50KG5vZGUpIHtcbiAgICAgIGlmIChub2RlLnBhcmVudCAmJiBub2RlLnBhcmVudC50eXBlID09PSAnVFNNb2R1bGVCbG9jaycpIHtcbiAgICAgICAgcmV0dXJuIG5vZGUucGFyZW50LnBhcmVudFxuICAgICAgfVxuXG4gICAgICAvLyBqdXN0IGluIGNhc2Ugc29tZWhvdyBhIG5vbi10cyBuYW1lc3BhY2UgZXhwb3J0IGRlY2xhcmF0aW9uIGlzbid0IGRpcmVjdGx5XG4gICAgICAvLyBwYXJlbnRlZCB0byB0aGUgcm9vdCBQcm9ncmFtIG5vZGVcbiAgICAgIHJldHVybiByb290UHJvZ3JhbVxuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICAnRXhwb3J0RGVmYXVsdERlY2xhcmF0aW9uJzogKG5vZGUpID0+IGFkZE5hbWVkKCdkZWZhdWx0Jywgbm9kZSwgZ2V0UGFyZW50KG5vZGUpKSxcblxuICAgICAgJ0V4cG9ydFNwZWNpZmllcic6IChub2RlKSA9PiBhZGROYW1lZChcbiAgICAgICAgbm9kZS5leHBvcnRlZC5uYW1lLFxuICAgICAgICBub2RlLmV4cG9ydGVkLFxuICAgICAgICBnZXRQYXJlbnQobm9kZS5wYXJlbnQpXG4gICAgICApLFxuXG4gICAgICAnRXhwb3J0TmFtZWREZWNsYXJhdGlvbic6IGZ1bmN0aW9uIChub2RlKSB7XG4gICAgICAgIGlmIChub2RlLmRlY2xhcmF0aW9uID09IG51bGwpIHJldHVyblxuXG4gICAgICAgIGNvbnN0IHBhcmVudCA9IGdldFBhcmVudChub2RlKVxuICAgICAgICAvLyBzdXBwb3J0IGZvciBvbGQgVHlwZVNjcmlwdCB2ZXJzaW9uc1xuICAgICAgICBjb25zdCBpc1R5cGVWYXJpYWJsZURlY2wgPSBub2RlLmRlY2xhcmF0aW9uLmtpbmQgPT09ICd0eXBlJ1xuXG4gICAgICAgIGlmIChub2RlLmRlY2xhcmF0aW9uLmlkICE9IG51bGwpIHtcbiAgICAgICAgICBpZiAoaW5jbHVkZXMoW1xuICAgICAgICAgICAgJ1RTVHlwZUFsaWFzRGVjbGFyYXRpb24nLFxuICAgICAgICAgICAgJ1RTSW50ZXJmYWNlRGVjbGFyYXRpb24nLFxuICAgICAgICAgIF0sIG5vZGUuZGVjbGFyYXRpb24udHlwZSkpIHtcbiAgICAgICAgICAgIGFkZE5hbWVkKG5vZGUuZGVjbGFyYXRpb24uaWQubmFtZSwgbm9kZS5kZWNsYXJhdGlvbi5pZCwgcGFyZW50LCB0cnVlKVxuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBhZGROYW1lZChub2RlLmRlY2xhcmF0aW9uLmlkLm5hbWUsIG5vZGUuZGVjbGFyYXRpb24uaWQsIHBhcmVudCwgaXNUeXBlVmFyaWFibGVEZWNsKVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChub2RlLmRlY2xhcmF0aW9uLmRlY2xhcmF0aW9ucyAhPSBudWxsKSB7XG4gICAgICAgICAgZm9yIChsZXQgZGVjbGFyYXRpb24gb2Ygbm9kZS5kZWNsYXJhdGlvbi5kZWNsYXJhdGlvbnMpIHtcbiAgICAgICAgICAgIHJlY3Vyc2l2ZVBhdHRlcm5DYXB0dXJlKGRlY2xhcmF0aW9uLmlkLCB2ID0+XG4gICAgICAgICAgICAgIGFkZE5hbWVkKHYubmFtZSwgdiwgcGFyZW50LCBpc1R5cGVWYXJpYWJsZURlY2wpKVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSxcblxuICAgICAgJ0V4cG9ydEFsbERlY2xhcmF0aW9uJzogZnVuY3Rpb24gKG5vZGUpIHtcbiAgICAgICAgaWYgKG5vZGUuc291cmNlID09IG51bGwpIHJldHVybiAvLyBub3Qgc3VyZSBpZiB0aGlzIGlzIGV2ZXIgdHJ1ZVxuXG4gICAgICAgIC8vIGBleHBvcnQgKiBhcyBYIGZyb20gJ3BhdGgnYCBkb2VzIG5vdCBjb25mbGljdFxuICAgICAgICBpZiAobm9kZS5leHBvcnRlZCAmJiBub2RlLmV4cG9ydGVkLm5hbWUpIHJldHVyblxuXG4gICAgICAgIGNvbnN0IHJlbW90ZUV4cG9ydHMgPSBFeHBvcnRNYXAuZ2V0KG5vZGUuc291cmNlLnZhbHVlLCBjb250ZXh0KVxuICAgICAgICBpZiAocmVtb3RlRXhwb3J0cyA9PSBudWxsKSByZXR1cm5cblxuICAgICAgICBpZiAocmVtb3RlRXhwb3J0cy5lcnJvcnMubGVuZ3RoKSB7XG4gICAgICAgICAgcmVtb3RlRXhwb3J0cy5yZXBvcnRFcnJvcnMoY29udGV4dCwgbm9kZSlcbiAgICAgICAgICByZXR1cm5cbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHBhcmVudCA9IGdldFBhcmVudChub2RlKVxuXG4gICAgICAgIGxldCBhbnkgPSBmYWxzZVxuICAgICAgICByZW1vdGVFeHBvcnRzLmZvckVhY2goKHYsIG5hbWUpID0+XG4gICAgICAgICAgbmFtZSAhPT0gJ2RlZmF1bHQnICYmXG4gICAgICAgICAgKGFueSA9IHRydWUpICYmIC8vIHBvb3IgbWFuJ3MgZmlsdGVyXG4gICAgICAgICAgYWRkTmFtZWQobmFtZSwgbm9kZSwgcGFyZW50KSlcblxuICAgICAgICBpZiAoIWFueSkge1xuICAgICAgICAgIGNvbnRleHQucmVwb3J0KFxuICAgICAgICAgICAgbm9kZS5zb3VyY2UsXG4gICAgICAgICAgICBgTm8gbmFtZWQgZXhwb3J0cyBmb3VuZCBpbiBtb2R1bGUgJyR7bm9kZS5zb3VyY2UudmFsdWV9Jy5gXG4gICAgICAgICAgKVxuICAgICAgICB9XG4gICAgICB9LFxuXG4gICAgICAnUHJvZ3JhbTpleGl0JzogZnVuY3Rpb24gKCkge1xuICAgICAgICBmb3IgKGxldCBbLCBuYW1lZF0gb2YgbmFtZXNwYWNlKSB7XG4gICAgICAgICAgZm9yIChsZXQgW25hbWUsIG5vZGVzXSBvZiBuYW1lZCkge1xuICAgICAgICAgICAgaWYgKG5vZGVzLnNpemUgPD0gMSkgY29udGludWVcblxuICAgICAgICAgICAgaWYgKGlzVHlwZXNjcmlwdEZ1bmN0aW9uT3ZlcmxvYWRzKG5vZGVzKSkgY29udGludWVcblxuICAgICAgICAgICAgZm9yIChsZXQgbm9kZSBvZiBub2Rlcykge1xuICAgICAgICAgICAgICBpZiAobmFtZSA9PT0gJ2RlZmF1bHQnKSB7XG4gICAgICAgICAgICAgICAgY29udGV4dC5yZXBvcnQobm9kZSwgJ011bHRpcGxlIGRlZmF1bHQgZXhwb3J0cy4nKVxuICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGNvbnRleHQucmVwb3J0KFxuICAgICAgICAgICAgICAgICAgbm9kZSxcbiAgICAgICAgICAgICAgICAgIGBNdWx0aXBsZSBleHBvcnRzIG9mIG5hbWUgJyR7bmFtZS5yZXBsYWNlKHRzVHlwZVByZWZpeCwgJycpfScuYFxuICAgICAgICAgICAgICAgIClcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSxcbiAgICB9XG4gIH0sXG59XG4iXX0=