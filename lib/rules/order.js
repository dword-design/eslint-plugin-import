'use strict';var _slicedToArray = function () {function sliceIterator(arr, i) {var _arr = [];var _n = true;var _d = false;var _e = undefined;try {for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) {_arr.push(_s.value);if (i && _arr.length === i) break;}} catch (err) {_d = true;_e = err;} finally {try {if (!_n && _i["return"]) _i["return"]();} finally {if (_d) throw _e;}}return _arr;}return function (arr, i) {if (Array.isArray(arr)) {return arr;} else if (Symbol.iterator in Object(arr)) {return sliceIterator(arr, i);} else {throw new TypeError("Invalid attempt to destructure non-iterable instance");}};}();

var _minimatch = require('minimatch');var _minimatch2 = _interopRequireDefault(_minimatch);
var _importType = require('../core/importType');var _importType2 = _interopRequireDefault(_importType);
var _staticRequire = require('../core/staticRequire');var _staticRequire2 = _interopRequireDefault(_staticRequire);
var _docsUrl = require('../docsUrl');var _docsUrl2 = _interopRequireDefault(_docsUrl);function _interopRequireDefault(obj) {return obj && obj.__esModule ? obj : { default: obj };}

const defaultGroups = ['builtin', 'external', 'parent', 'sibling', 'index'];

// REPORTING AND FIXING

function reverse(array) {
  return array.map(function (v) {
    return Object.assign({}, v, { rank: -v.rank });
  }).reverse();
}

function getTokensOrCommentsAfter(sourceCode, node, count) {
  let currentNodeOrToken = node;
  const result = [];
  for (let i = 0; i < count; i++) {
    currentNodeOrToken = sourceCode.getTokenOrCommentAfter(currentNodeOrToken);
    if (currentNodeOrToken == null) {
      break;
    }
    result.push(currentNodeOrToken);
  }
  return result;
}

function getTokensOrCommentsBefore(sourceCode, node, count) {
  let currentNodeOrToken = node;
  const result = [];
  for (let i = 0; i < count; i++) {
    currentNodeOrToken = sourceCode.getTokenOrCommentBefore(currentNodeOrToken);
    if (currentNodeOrToken == null) {
      break;
    }
    result.push(currentNodeOrToken);
  }
  return result.reverse();
}

function takeTokensAfterWhile(sourceCode, node, condition) {
  const tokens = getTokensOrCommentsAfter(sourceCode, node, 100);
  const result = [];
  for (let i = 0; i < tokens.length; i++) {
    if (condition(tokens[i])) {
      result.push(tokens[i]);
    } else
    {
      break;
    }
  }
  return result;
}

function takeTokensBeforeWhile(sourceCode, node, condition) {
  const tokens = getTokensOrCommentsBefore(sourceCode, node, 100);
  const result = [];
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (condition(tokens[i])) {
      result.push(tokens[i]);
    } else
    {
      break;
    }
  }
  return result.reverse();
}

function findOutOfOrder(imported) {
  if (imported.length === 0) {
    return [];
  }
  let maxSeenRankNode = imported[0];
  return imported.filter(function (importedModule) {
    const res = importedModule.rank < maxSeenRankNode.rank;
    if (maxSeenRankNode.rank < importedModule.rank) {
      maxSeenRankNode = importedModule;
    }
    return res;
  });
}

function findRootNode(node) {
  let parent = node;
  while (parent.parent != null && parent.parent.body == null) {
    parent = parent.parent;
  }
  return parent;
}

function findEndOfLineWithComments(sourceCode, node) {
  const tokensToEndOfLine = takeTokensAfterWhile(sourceCode, node, commentOnSameLineAs(node));
  let endOfTokens = tokensToEndOfLine.length > 0 ?
  tokensToEndOfLine[tokensToEndOfLine.length - 1].range[1] :
  node.range[1];
  let result = endOfTokens;
  for (let i = endOfTokens; i < sourceCode.text.length; i++) {
    if (sourceCode.text[i] === '\n') {
      result = i + 1;
      break;
    }
    if (sourceCode.text[i] !== ' ' && sourceCode.text[i] !== '\t' && sourceCode.text[i] !== '\r') {
      break;
    }
    result = i + 1;
  }
  return result;
}

function commentOnSameLineAs(node) {
  return token => (token.type === 'Block' || token.type === 'Line') &&
  token.loc.start.line === token.loc.end.line &&
  token.loc.end.line === node.loc.end.line;
}

function findStartOfLineWithComments(sourceCode, node) {
  const tokensToEndOfLine = takeTokensBeforeWhile(sourceCode, node, commentOnSameLineAs(node));
  let startOfTokens = tokensToEndOfLine.length > 0 ? tokensToEndOfLine[0].range[0] : node.range[0];
  let result = startOfTokens;
  for (let i = startOfTokens - 1; i > 0; i--) {
    if (sourceCode.text[i] !== ' ' && sourceCode.text[i] !== '\t') {
      break;
    }
    result = i;
  }
  return result;
}

function isPlainRequireModule(node) {
  if (node.type !== 'VariableDeclaration') {
    return false;
  }
  if (node.declarations.length !== 1) {
    return false;
  }
  const decl = node.declarations[0];
  const result = decl.id && (
  decl.id.type === 'Identifier' || decl.id.type === 'ObjectPattern') &&
  decl.init != null &&
  decl.init.type === 'CallExpression' &&
  decl.init.callee != null &&
  decl.init.callee.name === 'require' &&
  decl.init.arguments != null &&
  decl.init.arguments.length === 1 &&
  decl.init.arguments[0].type === 'Literal';
  return result;
}

function isPlainImportModule(node) {
  return node.type === 'ImportDeclaration' && node.specifiers != null && node.specifiers.length > 0;
}

function isPlainImportEquals(node) {
  return node.type === 'TSImportEqualsDeclaration' && node.moduleReference.expression;
}

function canCrossNodeWhileReorder(node) {
  return isPlainRequireModule(node) || isPlainImportModule(node) || isPlainImportEquals(node);
}

function canReorderItems(firstNode, secondNode) {
  const parent = firstNode.parent;var _sort =
  [
  parent.body.indexOf(firstNode),
  parent.body.indexOf(secondNode)].
  sort(),_sort2 = _slicedToArray(_sort, 2);const firstIndex = _sort2[0],secondIndex = _sort2[1];
  const nodesBetween = parent.body.slice(firstIndex, secondIndex + 1);
  for (var nodeBetween of nodesBetween) {
    if (!canCrossNodeWhileReorder(nodeBetween)) {
      return false;
    }
  }
  return true;
}

function fixOutOfOrder(context, firstNode, secondNode, order) {
  const sourceCode = context.getSourceCode();

  const firstRoot = findRootNode(firstNode.node);
  const firstRootStart = findStartOfLineWithComments(sourceCode, firstRoot);
  const firstRootEnd = findEndOfLineWithComments(sourceCode, firstRoot);

  const secondRoot = findRootNode(secondNode.node);
  const secondRootStart = findStartOfLineWithComments(sourceCode, secondRoot);
  const secondRootEnd = findEndOfLineWithComments(sourceCode, secondRoot);
  const canFix = canReorderItems(firstRoot, secondRoot);

  let newCode = sourceCode.text.substring(secondRootStart, secondRootEnd);
  if (newCode[newCode.length - 1] !== '\n') {
    newCode = newCode + '\n';
  }

  const message = `\`${secondNode.displayName}\` import should occur ${order} import of \`${firstNode.displayName}\``;

  if (order === 'before') {
    context.report({
      node: secondNode.node,
      message: message,
      fix: canFix && (fixer =>
      fixer.replaceTextRange(
      [firstRootStart, secondRootEnd],
      newCode + sourceCode.text.substring(firstRootStart, secondRootStart))) });


  } else if (order === 'after') {
    context.report({
      node: secondNode.node,
      message: message,
      fix: canFix && (fixer =>
      fixer.replaceTextRange(
      [secondRootStart, firstRootEnd],
      sourceCode.text.substring(secondRootEnd, firstRootEnd) + newCode)) });


  }
}

function reportOutOfOrder(context, imported, outOfOrder, order) {
  outOfOrder.forEach(function (imp) {
    const found = imported.find(function hasHigherRank(importedItem) {
      return importedItem.rank > imp.rank;
    });
    fixOutOfOrder(context, found, imp, order);
  });
}

function makeOutOfOrderReport(context, imported) {
  const outOfOrder = findOutOfOrder(imported);
  if (!outOfOrder.length) {
    return;
  }
  // There are things to report. Try to minimize the number of reported errors.
  const reversedImported = reverse(imported);
  const reversedOrder = findOutOfOrder(reversedImported);
  if (reversedOrder.length < outOfOrder.length) {
    reportOutOfOrder(context, reversedImported, reversedOrder, 'after');
    return;
  }
  reportOutOfOrder(context, imported, outOfOrder, 'before');
}

function getSorter(ascending) {
  const multiplier = ascending ? 1 : -1;

  return function importsSorter(importA, importB) {
    let result;

    if (importA < importB) {
      result = -1;
    } else if (importA > importB) {
      result = 1;
    } else {
      result = 0;
    }

    return result * multiplier;
  };
}

function mutateRanksToAlphabetize(imported, alphabetizeOptions) {
  const groupedByRanks = imported.reduce(function (acc, importedItem) {
    if (!Array.isArray(acc[importedItem.rank])) {
      acc[importedItem.rank] = [];
    }
    acc[importedItem.rank].push(importedItem.value);
    return acc;
  }, {});

  const groupRanks = Object.keys(groupedByRanks);

  const sorterFn = getSorter(alphabetizeOptions.order === 'asc');
  const comparator = alphabetizeOptions.caseInsensitive ? (a, b) => sorterFn(String(a).toLowerCase(), String(b).toLowerCase()) : (a, b) => sorterFn(a, b);
  // sort imports locally within their group
  groupRanks.forEach(function (groupRank) {
    groupedByRanks[groupRank].sort(comparator);
  });

  // assign globally unique rank to each import
  let newRank = 0;
  const alphabetizedRanks = groupRanks.sort().reduce(function (acc, groupRank) {
    groupedByRanks[groupRank].forEach(function (importedItemName) {
      acc[importedItemName] = parseInt(groupRank, 10) + newRank;
      newRank += 1;
    });
    return acc;
  }, {});

  // mutate the original group-rank with alphabetized-rank
  imported.forEach(function (importedItem) {
    importedItem.rank = alphabetizedRanks[importedItem.value];
  });
}

// DETECTING

function computePathRank(ranks, pathGroups, path, maxPosition) {
  for (let i = 0, l = pathGroups.length; i < l; i++) {var _pathGroups$i =
    pathGroups[i];const pattern = _pathGroups$i.pattern,patternOptions = _pathGroups$i.patternOptions,group = _pathGroups$i.group;var _pathGroups$i$positio = _pathGroups$i.position;const position = _pathGroups$i$positio === undefined ? 1 : _pathGroups$i$positio;
    if ((0, _minimatch2.default)(path, pattern, patternOptions || { nocomment: true })) {
      return ranks[group] + position / maxPosition;
    }
  }
}

function computeRank(context, ranks, importEntry, excludedImportTypes) {
  let impType;
  let rank;
  if (importEntry.type === 'import:object') {
    impType = 'object';
  } else {
    impType = (0, _importType2.default)(importEntry.value, context);
  }
  if (!excludedImportTypes.has(impType)) {
    rank = computePathRank(ranks.groups, ranks.pathGroups, importEntry.value, ranks.maxPosition);
  }
  if (typeof rank === 'undefined') {
    rank = ranks.groups[impType];
  }
  if (importEntry.type !== 'import' && !importEntry.type.startsWith('import:')) {
    rank += 100;
  }

  return rank;
}

function registerNode(context, importEntry, ranks, imported, excludedImportTypes) {
  const rank = computeRank(context, ranks, importEntry, excludedImportTypes);
  if (rank !== -1) {
    imported.push(Object.assign({}, importEntry, { rank }));
  }
}

function isModuleLevelRequire(node) {
  let n = node;
  // Handle cases like `const baz = require('foo').bar.baz`
  // and `const foo = require('foo')()`
  while (
  n.parent.type === 'MemberExpression' && n.parent.object === n ||
  n.parent.type === 'CallExpression' && n.parent.callee === n)
  {
    n = n.parent;
  }
  return (
    n.parent.type === 'VariableDeclarator' &&
    n.parent.parent.type === 'VariableDeclaration' &&
    n.parent.parent.parent.type === 'Program');

}

const types = ['builtin', 'external', 'internal', 'unknown', 'parent', 'sibling', 'index', 'object'];

// Creates an object with type-rank pairs.
// Example: { index: 0, sibling: 1, parent: 1, external: 1, builtin: 2, internal: 2 }
// Will throw an error if it contains a type that does not exist, or has a duplicate
function convertGroupsToRanks(groups) {
  const rankObject = groups.reduce(function (res, group, index) {
    if (typeof group === 'string') {
      group = [group];
    }
    group.forEach(function (groupItem) {
      if (types.indexOf(groupItem) === -1) {
        throw new Error('Incorrect configuration of the rule: Unknown type `' +
        JSON.stringify(groupItem) + '`');
      }
      if (res[groupItem] !== undefined) {
        throw new Error('Incorrect configuration of the rule: `' + groupItem + '` is duplicated');
      }
      res[groupItem] = index;
    });
    return res;
  }, {});

  const omittedTypes = types.filter(function (type) {
    return rankObject[type] === undefined;
  });

  return omittedTypes.reduce(function (res, type) {
    res[type] = groups.length;
    return res;
  }, rankObject);
}

function convertPathGroupsForRanks(pathGroups) {
  const after = {};
  const before = {};

  const transformed = pathGroups.map((pathGroup, index) => {const
    group = pathGroup.group,positionString = pathGroup.position;
    let position = 0;
    if (positionString === 'after') {
      if (!after[group]) {
        after[group] = 1;
      }
      position = after[group]++;
    } else if (positionString === 'before') {
      if (!before[group]) {
        before[group] = [];
      }
      before[group].push(index);
    }

    return Object.assign({}, pathGroup, { position });
  });

  let maxPosition = 1;

  Object.keys(before).forEach(group => {
    const groupLength = before[group].length;
    before[group].forEach((groupIndex, index) => {
      transformed[groupIndex].position = -1 * (groupLength - index);
    });
    maxPosition = Math.max(maxPosition, groupLength);
  });

  Object.keys(after).forEach(key => {
    const groupNextPosition = after[key];
    maxPosition = Math.max(maxPosition, groupNextPosition - 1);
  });

  return {
    pathGroups: transformed,
    maxPosition: maxPosition > 10 ? Math.pow(10, Math.ceil(Math.log10(maxPosition))) : 10 };

}

function fixNewLineAfterImport(context, previousImport) {
  const prevRoot = findRootNode(previousImport.node);
  const tokensToEndOfLine = takeTokensAfterWhile(
  context.getSourceCode(), prevRoot, commentOnSameLineAs(prevRoot));

  let endOfLine = prevRoot.range[1];
  if (tokensToEndOfLine.length > 0) {
    endOfLine = tokensToEndOfLine[tokensToEndOfLine.length - 1].range[1];
  }
  return fixer => fixer.insertTextAfterRange([prevRoot.range[0], endOfLine], '\n');
}

function removeNewLineAfterImport(context, currentImport, previousImport) {
  const sourceCode = context.getSourceCode();
  const prevRoot = findRootNode(previousImport.node);
  const currRoot = findRootNode(currentImport.node);
  const rangeToRemove = [
  findEndOfLineWithComments(sourceCode, prevRoot),
  findStartOfLineWithComments(sourceCode, currRoot)];

  if (/^\s*$/.test(sourceCode.text.substring(rangeToRemove[0], rangeToRemove[1]))) {
    return fixer => fixer.removeRange(rangeToRemove);
  }
  return undefined;
}

function makeNewlinesBetweenReport(context, imported, newlinesBetweenImports) {
  const getNumberOfEmptyLinesBetween = (currentImport, previousImport) => {
    const linesBetweenImports = context.getSourceCode().lines.slice(
    previousImport.node.loc.end.line,
    currentImport.node.loc.start.line - 1);


    return linesBetweenImports.filter(line => !line.trim().length).length;
  };
  let previousImport = imported[0];

  imported.slice(1).forEach(function (currentImport) {
    const emptyLinesBetween = getNumberOfEmptyLinesBetween(currentImport, previousImport);

    if (newlinesBetweenImports === 'always' ||
    newlinesBetweenImports === 'always-and-inside-groups') {
      if (currentImport.rank !== previousImport.rank && emptyLinesBetween === 0) {
        context.report({
          node: previousImport.node,
          message: 'There should be at least one empty line between import groups',
          fix: fixNewLineAfterImport(context, previousImport) });

      } else if (currentImport.rank === previousImport.rank &&
      emptyLinesBetween > 0 &&
      newlinesBetweenImports !== 'always-and-inside-groups') {
        context.report({
          node: previousImport.node,
          message: 'There should be no empty line within import group',
          fix: removeNewLineAfterImport(context, currentImport, previousImport) });

      }
    } else if (emptyLinesBetween > 0) {
      context.report({
        node: previousImport.node,
        message: 'There should be no empty line between import groups',
        fix: removeNewLineAfterImport(context, currentImport, previousImport) });

    }

    previousImport = currentImport;
  });
}

function getAlphabetizeConfig(options) {
  const alphabetize = options.alphabetize || {};
  const order = alphabetize.order || 'ignore';
  const caseInsensitive = alphabetize.caseInsensitive || false;

  return { order, caseInsensitive };
}

module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      url: (0, _docsUrl2.default)('order') },


    fixable: 'code',
    schema: [
    {
      type: 'object',
      properties: {
        groups: {
          type: 'array' },

        pathGroupsExcludedImportTypes: {
          type: 'array' },

        pathGroups: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              pattern: {
                type: 'string' },

              patternOptions: {
                type: 'object' },

              group: {
                type: 'string',
                enum: types },

              position: {
                type: 'string',
                enum: ['after', 'before'] } },


            required: ['pattern', 'group'] } },


        'newlines-between': {
          enum: [
          'ignore',
          'always',
          'always-and-inside-groups',
          'never'] },


        alphabetize: {
          type: 'object',
          properties: {
            caseInsensitive: {
              type: 'boolean',
              default: false },

            order: {
              enum: ['ignore', 'asc', 'desc'],
              default: 'ignore' } },


          additionalProperties: false } },


      additionalProperties: false }] },




  create: function importOrderRule(context) {
    const options = context.options[0] || {};
    const newlinesBetweenImports = options['newlines-between'] || 'ignore';
    const pathGroupsExcludedImportTypes = new Set(options['pathGroupsExcludedImportTypes'] || ['builtin', 'external', 'object']);
    const alphabetize = getAlphabetizeConfig(options);
    let ranks;

    try {var _convertPathGroupsFor =
      convertPathGroupsForRanks(options.pathGroups || []);const pathGroups = _convertPathGroupsFor.pathGroups,maxPosition = _convertPathGroupsFor.maxPosition;
      ranks = {
        groups: convertGroupsToRanks(options.groups || defaultGroups),
        pathGroups,
        maxPosition };

    } catch (error) {
      // Malformed configuration
      return {
        Program: function (node) {
          context.report(node, error.message);
        } };

    }
    let imported = [];

    return {
      ImportDeclaration: function handleImports(node) {
        if (node.specifiers.length) {// Ignoring unassigned imports
          const name = node.source.value;
          registerNode(
          context,
          {
            node,
            value: name,
            displayName: name,
            type: 'import' },

          ranks,
          imported,
          pathGroupsExcludedImportTypes);

        }
      },
      TSImportEqualsDeclaration: function handleImports(node) {
        let displayName;
        let value;
        let type;
        // skip "export import"s
        if (node.isExport) {
          return;
        }
        if (node.moduleReference.type === 'TSExternalModuleReference') {
          value = node.moduleReference.expression.value;
          displayName = value;
          type = 'import';
        } else {
          value = '';
          displayName = context.getSourceCode().getText(node.moduleReference);
          type = 'import:object';
        }
        registerNode(
        context,
        {
          node,
          value,
          displayName,
          type },

        ranks,
        imported,
        pathGroupsExcludedImportTypes);

      },
      CallExpression: function handleRequires(node) {
        if (!(0, _staticRequire2.default)(node) || !isModuleLevelRequire(node)) {
          return;
        }
        const name = node.arguments[0].value;
        registerNode(
        context,
        {
          node,
          value: name,
          displayName: name,
          type: 'require' },

        ranks,
        imported,
        pathGroupsExcludedImportTypes);

      },
      'Program:exit': function reportAndReset() {
        if (newlinesBetweenImports !== 'ignore') {
          makeNewlinesBetweenReport(context, imported, newlinesBetweenImports);
        }

        if (alphabetize.order !== 'ignore') {
          mutateRanksToAlphabetize(imported, alphabetize);
        }

        makeOutOfOrderReport(context, imported);

        imported = [];
      } };

  } };
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9ydWxlcy9vcmRlci5qcyJdLCJuYW1lcyI6WyJkZWZhdWx0R3JvdXBzIiwicmV2ZXJzZSIsImFycmF5IiwibWFwIiwidiIsIk9iamVjdCIsImFzc2lnbiIsInJhbmsiLCJnZXRUb2tlbnNPckNvbW1lbnRzQWZ0ZXIiLCJzb3VyY2VDb2RlIiwibm9kZSIsImNvdW50IiwiY3VycmVudE5vZGVPclRva2VuIiwicmVzdWx0IiwiaSIsImdldFRva2VuT3JDb21tZW50QWZ0ZXIiLCJwdXNoIiwiZ2V0VG9rZW5zT3JDb21tZW50c0JlZm9yZSIsImdldFRva2VuT3JDb21tZW50QmVmb3JlIiwidGFrZVRva2Vuc0FmdGVyV2hpbGUiLCJjb25kaXRpb24iLCJ0b2tlbnMiLCJsZW5ndGgiLCJ0YWtlVG9rZW5zQmVmb3JlV2hpbGUiLCJmaW5kT3V0T2ZPcmRlciIsImltcG9ydGVkIiwibWF4U2VlblJhbmtOb2RlIiwiZmlsdGVyIiwiaW1wb3J0ZWRNb2R1bGUiLCJyZXMiLCJmaW5kUm9vdE5vZGUiLCJwYXJlbnQiLCJib2R5IiwiZmluZEVuZE9mTGluZVdpdGhDb21tZW50cyIsInRva2Vuc1RvRW5kT2ZMaW5lIiwiY29tbWVudE9uU2FtZUxpbmVBcyIsImVuZE9mVG9rZW5zIiwicmFuZ2UiLCJ0ZXh0IiwidG9rZW4iLCJ0eXBlIiwibG9jIiwic3RhcnQiLCJsaW5lIiwiZW5kIiwiZmluZFN0YXJ0T2ZMaW5lV2l0aENvbW1lbnRzIiwic3RhcnRPZlRva2VucyIsImlzUGxhaW5SZXF1aXJlTW9kdWxlIiwiZGVjbGFyYXRpb25zIiwiZGVjbCIsImlkIiwiaW5pdCIsImNhbGxlZSIsIm5hbWUiLCJhcmd1bWVudHMiLCJpc1BsYWluSW1wb3J0TW9kdWxlIiwic3BlY2lmaWVycyIsImlzUGxhaW5JbXBvcnRFcXVhbHMiLCJtb2R1bGVSZWZlcmVuY2UiLCJleHByZXNzaW9uIiwiY2FuQ3Jvc3NOb2RlV2hpbGVSZW9yZGVyIiwiY2FuUmVvcmRlckl0ZW1zIiwiZmlyc3ROb2RlIiwic2Vjb25kTm9kZSIsImluZGV4T2YiLCJzb3J0IiwiZmlyc3RJbmRleCIsInNlY29uZEluZGV4Iiwibm9kZXNCZXR3ZWVuIiwic2xpY2UiLCJub2RlQmV0d2VlbiIsImZpeE91dE9mT3JkZXIiLCJjb250ZXh0Iiwib3JkZXIiLCJnZXRTb3VyY2VDb2RlIiwiZmlyc3RSb290IiwiZmlyc3RSb290U3RhcnQiLCJmaXJzdFJvb3RFbmQiLCJzZWNvbmRSb290Iiwic2Vjb25kUm9vdFN0YXJ0Iiwic2Vjb25kUm9vdEVuZCIsImNhbkZpeCIsIm5ld0NvZGUiLCJzdWJzdHJpbmciLCJtZXNzYWdlIiwiZGlzcGxheU5hbWUiLCJyZXBvcnQiLCJmaXgiLCJmaXhlciIsInJlcGxhY2VUZXh0UmFuZ2UiLCJyZXBvcnRPdXRPZk9yZGVyIiwib3V0T2ZPcmRlciIsImZvckVhY2giLCJpbXAiLCJmb3VuZCIsImZpbmQiLCJoYXNIaWdoZXJSYW5rIiwiaW1wb3J0ZWRJdGVtIiwibWFrZU91dE9mT3JkZXJSZXBvcnQiLCJyZXZlcnNlZEltcG9ydGVkIiwicmV2ZXJzZWRPcmRlciIsImdldFNvcnRlciIsImFzY2VuZGluZyIsIm11bHRpcGxpZXIiLCJpbXBvcnRzU29ydGVyIiwiaW1wb3J0QSIsImltcG9ydEIiLCJtdXRhdGVSYW5rc1RvQWxwaGFiZXRpemUiLCJhbHBoYWJldGl6ZU9wdGlvbnMiLCJncm91cGVkQnlSYW5rcyIsInJlZHVjZSIsImFjYyIsIkFycmF5IiwiaXNBcnJheSIsInZhbHVlIiwiZ3JvdXBSYW5rcyIsImtleXMiLCJzb3J0ZXJGbiIsImNvbXBhcmF0b3IiLCJjYXNlSW5zZW5zaXRpdmUiLCJhIiwiYiIsIlN0cmluZyIsInRvTG93ZXJDYXNlIiwiZ3JvdXBSYW5rIiwibmV3UmFuayIsImFscGhhYmV0aXplZFJhbmtzIiwiaW1wb3J0ZWRJdGVtTmFtZSIsInBhcnNlSW50IiwiY29tcHV0ZVBhdGhSYW5rIiwicmFua3MiLCJwYXRoR3JvdXBzIiwicGF0aCIsIm1heFBvc2l0aW9uIiwibCIsInBhdHRlcm4iLCJwYXR0ZXJuT3B0aW9ucyIsImdyb3VwIiwicG9zaXRpb24iLCJub2NvbW1lbnQiLCJjb21wdXRlUmFuayIsImltcG9ydEVudHJ5IiwiZXhjbHVkZWRJbXBvcnRUeXBlcyIsImltcFR5cGUiLCJoYXMiLCJncm91cHMiLCJzdGFydHNXaXRoIiwicmVnaXN0ZXJOb2RlIiwiaXNNb2R1bGVMZXZlbFJlcXVpcmUiLCJuIiwib2JqZWN0IiwidHlwZXMiLCJjb252ZXJ0R3JvdXBzVG9SYW5rcyIsInJhbmtPYmplY3QiLCJpbmRleCIsImdyb3VwSXRlbSIsIkVycm9yIiwiSlNPTiIsInN0cmluZ2lmeSIsInVuZGVmaW5lZCIsIm9taXR0ZWRUeXBlcyIsImNvbnZlcnRQYXRoR3JvdXBzRm9yUmFua3MiLCJhZnRlciIsImJlZm9yZSIsInRyYW5zZm9ybWVkIiwicGF0aEdyb3VwIiwicG9zaXRpb25TdHJpbmciLCJncm91cExlbmd0aCIsImdyb3VwSW5kZXgiLCJNYXRoIiwibWF4Iiwia2V5IiwiZ3JvdXBOZXh0UG9zaXRpb24iLCJwb3ciLCJjZWlsIiwibG9nMTAiLCJmaXhOZXdMaW5lQWZ0ZXJJbXBvcnQiLCJwcmV2aW91c0ltcG9ydCIsInByZXZSb290IiwiZW5kT2ZMaW5lIiwiaW5zZXJ0VGV4dEFmdGVyUmFuZ2UiLCJyZW1vdmVOZXdMaW5lQWZ0ZXJJbXBvcnQiLCJjdXJyZW50SW1wb3J0IiwiY3VyclJvb3QiLCJyYW5nZVRvUmVtb3ZlIiwidGVzdCIsInJlbW92ZVJhbmdlIiwibWFrZU5ld2xpbmVzQmV0d2VlblJlcG9ydCIsIm5ld2xpbmVzQmV0d2VlbkltcG9ydHMiLCJnZXROdW1iZXJPZkVtcHR5TGluZXNCZXR3ZWVuIiwibGluZXNCZXR3ZWVuSW1wb3J0cyIsImxpbmVzIiwidHJpbSIsImVtcHR5TGluZXNCZXR3ZWVuIiwiZ2V0QWxwaGFiZXRpemVDb25maWciLCJvcHRpb25zIiwiYWxwaGFiZXRpemUiLCJtb2R1bGUiLCJleHBvcnRzIiwibWV0YSIsImRvY3MiLCJ1cmwiLCJmaXhhYmxlIiwic2NoZW1hIiwicHJvcGVydGllcyIsInBhdGhHcm91cHNFeGNsdWRlZEltcG9ydFR5cGVzIiwiaXRlbXMiLCJlbnVtIiwicmVxdWlyZWQiLCJkZWZhdWx0IiwiYWRkaXRpb25hbFByb3BlcnRpZXMiLCJjcmVhdGUiLCJpbXBvcnRPcmRlclJ1bGUiLCJTZXQiLCJlcnJvciIsIlByb2dyYW0iLCJJbXBvcnREZWNsYXJhdGlvbiIsImhhbmRsZUltcG9ydHMiLCJzb3VyY2UiLCJUU0ltcG9ydEVxdWFsc0RlY2xhcmF0aW9uIiwiaXNFeHBvcnQiLCJnZXRUZXh0IiwiQ2FsbEV4cHJlc3Npb24iLCJoYW5kbGVSZXF1aXJlcyIsInJlcG9ydEFuZFJlc2V0Il0sIm1hcHBpbmdzIjoiQUFBQSxhOztBQUVBLHNDO0FBQ0EsZ0Q7QUFDQSxzRDtBQUNBLHFDOztBQUVBLE1BQU1BLGdCQUFnQixDQUFDLFNBQUQsRUFBWSxVQUFaLEVBQXdCLFFBQXhCLEVBQWtDLFNBQWxDLEVBQTZDLE9BQTdDLENBQXRCOztBQUVBOztBQUVBLFNBQVNDLE9BQVQsQ0FBaUJDLEtBQWpCLEVBQXdCO0FBQ3RCLFNBQU9BLE1BQU1DLEdBQU4sQ0FBVSxVQUFVQyxDQUFWLEVBQWE7QUFDNUIsV0FBT0MsT0FBT0MsTUFBUCxDQUFjLEVBQWQsRUFBa0JGLENBQWxCLEVBQXFCLEVBQUVHLE1BQU0sQ0FBQ0gsRUFBRUcsSUFBWCxFQUFyQixDQUFQO0FBQ0QsR0FGTSxFQUVKTixPQUZJLEVBQVA7QUFHRDs7QUFFRCxTQUFTTyx3QkFBVCxDQUFrQ0MsVUFBbEMsRUFBOENDLElBQTlDLEVBQW9EQyxLQUFwRCxFQUEyRDtBQUN6RCxNQUFJQyxxQkFBcUJGLElBQXpCO0FBQ0EsUUFBTUcsU0FBUyxFQUFmO0FBQ0EsT0FBSyxJQUFJQyxJQUFJLENBQWIsRUFBZ0JBLElBQUlILEtBQXBCLEVBQTJCRyxHQUEzQixFQUFnQztBQUM5QkYseUJBQXFCSCxXQUFXTSxzQkFBWCxDQUFrQ0gsa0JBQWxDLENBQXJCO0FBQ0EsUUFBSUEsc0JBQXNCLElBQTFC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O0FBQ0UzRSxlQURGO0FBRUU7QUFDRTlELGNBREY7QUFFRXdHLGVBRkY7QUFHRTdCLHFCQUhGO0FBSUU3QyxjQUpGLEVBRkY7O0FBUUUwRixhQVJGO0FBU0V6RyxnQkFURjtBQVVFb0wscUNBVkY7O0FBWUQsT0EvQ0k7QUFnRExpQixzQkFBZ0IsU0FBU0MsY0FBVCxDQUF3QnJOLElBQXhCLEVBQThCO0FBQzVDLFlBQUksQ0FBQyw2QkFBZ0JBLElBQWhCLENBQUQsSUFBMEIsQ0FBQzBJLHFCQUFxQjFJLElBQXJCLENBQS9CLEVBQTJEO0FBQ3pEO0FBQ0Q7QUFDRCxjQUFNMkMsT0FBTzNDLEtBQUs0QyxTQUFMLENBQWUsQ0FBZixFQUFrQjRELEtBQS9CO0FBQ0FpQztBQUNFM0UsZUFERjtBQUVFO0FBQ0U5RCxjQURGO0FBRUV3RyxpQkFBTzdELElBRlQ7QUFHRWdDLHVCQUFhaEMsSUFIZjtBQUlFYixnQkFBTSxTQUpSLEVBRkY7O0FBUUUwRixhQVJGO0FBU0V6RyxnQkFURjtBQVVFb0wscUNBVkY7O0FBWUQsT0FqRUk7QUFrRUwsc0JBQWdCLFNBQVNtQixjQUFULEdBQTBCO0FBQ3hDLFlBQUlwQywyQkFBMkIsUUFBL0IsRUFBeUM7QUFDdkNELG9DQUEwQm5ILE9BQTFCLEVBQW1DL0MsUUFBbkMsRUFBNkNtSyxzQkFBN0M7QUFDRDs7QUFFRCxZQUFJUSxZQUFZM0gsS0FBWixLQUFzQixRQUExQixFQUFvQztBQUNsQ2tDLG1DQUF5QmxGLFFBQXpCLEVBQW1DMkssV0FBbkM7QUFDRDs7QUFFRGxHLDZCQUFxQjFCLE9BQXJCLEVBQThCL0MsUUFBOUI7O0FBRUFBLG1CQUFXLEVBQVg7QUFDRCxPQTlFSSxFQUFQOztBQWdGRCxHQTdLYyxFQUFqQiIsImZpbGUiOiJvcmRlci5qcyIsInNvdXJjZXNDb250ZW50IjpbIid1c2Ugc3RyaWN0J1xuXG5pbXBvcnQgbWluaW1hdGNoIGZyb20gJ21pbmltYXRjaCdcbmltcG9ydCBpbXBvcnRUeXBlIGZyb20gJy4uL2NvcmUvaW1wb3J0VHlwZSdcbmltcG9ydCBpc1N0YXRpY1JlcXVpcmUgZnJvbSAnLi4vY29yZS9zdGF0aWNSZXF1aXJlJ1xuaW1wb3J0IGRvY3NVcmwgZnJvbSAnLi4vZG9jc1VybCdcblxuY29uc3QgZGVmYXVsdEdyb3VwcyA9IFsnYnVpbHRpbicsICdleHRlcm5hbCcsICdwYXJlbnQnLCAnc2libGluZycsICdpbmRleCddXG5cbi8vIFJFUE9SVElORyBBTkQgRklYSU5HXG5cbmZ1bmN0aW9uIHJldmVyc2UoYXJyYXkpIHtcbiAgcmV0dXJuIGFycmF5Lm1hcChmdW5jdGlvbiAodikge1xuICAgIHJldHVybiBPYmplY3QuYXNzaWduKHt9LCB2LCB7IHJhbms6IC12LnJhbmsgfSlcbiAgfSkucmV2ZXJzZSgpXG59XG5cbmZ1bmN0aW9uIGdldFRva2Vuc09yQ29tbWVudHNBZnRlcihzb3VyY2VDb2RlLCBub2RlLCBjb3VudCkge1xuICBsZXQgY3VycmVudE5vZGVPclRva2VuID0gbm9kZVxuICBjb25zdCByZXN1bHQgPSBbXVxuICBmb3IgKGxldCBpID0gMDsgaSA8IGNvdW50OyBpKyspIHtcbiAgICBjdXJyZW50Tm9kZU9yVG9rZW4gPSBzb3VyY2VDb2RlLmdldFRva2VuT3JDb21tZW50QWZ0ZXIoY3VycmVudE5vZGVPclRva2VuKVxuICAgIGlmIChjdXJyZW50Tm9kZU9yVG9rZW4gPT0gbnVsbCkge1xuICAgICAgYnJlYWtcbiAgICB9XG4gICAgcmVzdWx0LnB1c2goY3VycmVudE5vZGVPclRva2VuKVxuICB9XG4gIHJldHVybiByZXN1bHRcbn1cblxuZnVuY3Rpb24gZ2V0VG9rZW5zT3JDb21tZW50c0JlZm9yZShzb3VyY2VDb2RlLCBub2RlLCBjb3VudCkge1xuICBsZXQgY3VycmVudE5vZGVPclRva2VuID0gbm9kZVxuICBjb25zdCByZXN1bHQgPSBbXVxuICBmb3IgKGxldCBpID0gMDsgaSA8IGNvdW50OyBpKyspIHtcbiAgICBjdXJyZW50Tm9kZU9yVG9rZW4gPSBzb3VyY2VDb2RlLmdldFRva2VuT3JDb21tZW50QmVmb3JlKGN1cnJlbnROb2RlT3JUb2tlbilcbiAgICBpZiAoY3VycmVudE5vZGVPclRva2VuID09IG51bGwpIHtcbiAgICAgIGJyZWFrXG4gICAgfVxuICAgIHJlc3VsdC5wdXNoKGN1cnJlbnROb2RlT3JUb2tlbilcbiAgfVxuICByZXR1cm4gcmVzdWx0LnJldmVyc2UoKVxufVxuXG5mdW5jdGlvbiB0YWtlVG9rZW5zQWZ0ZXJXaGlsZShzb3VyY2VDb2RlLCBub2RlLCBjb25kaXRpb24pIHtcbiAgY29uc3QgdG9rZW5zID0gZ2V0VG9rZW5zT3JDb21tZW50c0FmdGVyKHNvdXJjZUNvZGUsIG5vZGUsIDEwMClcbiAgY29uc3QgcmVzdWx0ID0gW11cbiAgZm9yIChsZXQgaSA9IDA7IGkgPCB0b2tlbnMubGVuZ3RoOyBpKyspIHtcbiAgICBpZiAoY29uZGl0aW9uKHRva2Vuc1tpXSkpIHtcbiAgICAgIHJlc3VsdC5wdXNoKHRva2Vuc1tpXSlcbiAgICB9XG4gICAgZWxzZSB7XG4gICAgICBicmVha1xuICAgIH1cbiAgfVxuICByZXR1cm4gcmVzdWx0XG59XG5cbmZ1bmN0aW9uIHRha2VUb2tlbnNCZWZvcmVXaGlsZShzb3VyY2VDb2RlLCBub2RlLCBjb25kaXRpb24pIHtcbiAgY29uc3QgdG9rZW5zID0gZ2V0VG9rZW5zT3JDb21tZW50c0JlZm9yZShzb3VyY2VDb2RlLCBub2RlLCAxMDApXG4gIGNvbnN0IHJlc3VsdCA9IFtdXG4gIGZvciAobGV0IGkgPSB0b2tlbnMubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0pIHtcbiAgICBpZiAoY29uZGl0aW9uKHRva2Vuc1tpXSkpIHtcbiAgICAgIHJlc3VsdC5wdXNoKHRva2Vuc1tpXSlcbiAgICB9XG4gICAgZWxzZSB7XG4gICAgICBicmVha1xuICAgIH1cbiAgfVxuICByZXR1cm4gcmVzdWx0LnJldmVyc2UoKVxufVxuXG5mdW5jdGlvbiBmaW5kT3V0T2ZPcmRlcihpbXBvcnRlZCkge1xuICBpZiAoaW1wb3J0ZWQubGVuZ3RoID09PSAwKSB7XG4gICAgcmV0dXJuIFtdXG4gIH1cbiAgbGV0IG1heFNlZW5SYW5rTm9kZSA9IGltcG9ydGVkWzBdXG4gIHJldHVybiBpbXBvcnRlZC5maWx0ZXIoZnVuY3Rpb24gKGltcG9ydGVkTW9kdWxlKSB7XG4gICAgY29uc3QgcmVzID0gaW1wb3J0ZWRNb2R1bGUucmFuayA8IG1heFNlZW5SYW5rTm9kZS5yYW5rXG4gICAgaWYgKG1heFNlZW5SYW5rTm9kZS5yYW5rIDwgaW1wb3J0ZWRNb2R1bGUucmFuaykge1xuICAgICAgbWF4U2VlblJhbmtOb2RlID0gaW1wb3J0ZWRNb2R1bGVcbiAgICB9XG4gICAgcmV0dXJuIHJlc1xuICB9KVxufVxuXG5mdW5jdGlvbiBmaW5kUm9vdE5vZGUobm9kZSkge1xuICBsZXQgcGFyZW50ID0gbm9kZVxuICB3aGlsZSAocGFyZW50LnBhcmVudCAhPSBudWxsICYmIHBhcmVudC5wYXJlbnQuYm9keSA9PSBudWxsKSB7XG4gICAgcGFyZW50ID0gcGFyZW50LnBhcmVudFxuICB9XG4gIHJldHVybiBwYXJlbnRcbn1cblxuZnVuY3Rpb24gZmluZEVuZE9mTGluZVdpdGhDb21tZW50cyhzb3VyY2VDb2RlLCBub2RlKSB7XG4gIGNvbnN0IHRva2Vuc1RvRW5kT2ZMaW5lID0gdGFrZVRva2Vuc0FmdGVyV2hpbGUoc291cmNlQ29kZSwgbm9kZSwgY29tbWVudE9uU2FtZUxpbmVBcyhub2RlKSlcbiAgbGV0IGVuZE9mVG9rZW5zID0gdG9rZW5zVG9FbmRPZkxpbmUubGVuZ3RoID4gMFxuICAgID8gdG9rZW5zVG9FbmRPZkxpbmVbdG9rZW5zVG9FbmRPZkxpbmUubGVuZ3RoIC0gMV0ucmFuZ2VbMV1cbiAgICA6IG5vZGUucmFuZ2VbMV1cbiAgbGV0IHJlc3VsdCA9IGVuZE9mVG9rZW5zXG4gIGZvciAobGV0IGkgPSBlbmRPZlRva2VuczsgaSA8IHNvdXJjZUNvZGUudGV4dC5sZW5ndGg7IGkrKykge1xuICAgIGlmIChzb3VyY2VDb2RlLnRleHRbaV0gPT09ICdcXG4nKSB7XG4gICAgICByZXN1bHQgPSBpICsgMVxuICAgICAgYnJlYWtcbiAgICB9XG4gICAgaWYgKHNvdXJjZUNvZGUudGV4dFtpXSAhPT0gJyAnICYmIHNvdXJjZUNvZGUudGV4dFtpXSAhPT0gJ1xcdCcgJiYgc291cmNlQ29kZS50ZXh0W2ldICE9PSAnXFxyJykge1xuICAgICAgYnJlYWtcbiAgICB9XG4gICAgcmVzdWx0ID0gaSArIDFcbiAgfVxuICByZXR1cm4gcmVzdWx0XG59XG5cbmZ1bmN0aW9uIGNvbW1lbnRPblNhbWVMaW5lQXMobm9kZSkge1xuICByZXR1cm4gdG9rZW4gPT4gKHRva2VuLnR5cGUgPT09ICdCbG9jaycgfHwgIHRva2VuLnR5cGUgPT09ICdMaW5lJykgJiZcbiAgICAgIHRva2VuLmxvYy5zdGFydC5saW5lID09PSB0b2tlbi5sb2MuZW5kLmxpbmUgJiZcbiAgICAgIHRva2VuLmxvYy5lbmQubGluZSA9PT0gbm9kZS5sb2MuZW5kLmxpbmVcbn1cblxuZnVuY3Rpb24gZmluZFN0YXJ0T2ZMaW5lV2l0aENvbW1lbnRzKHNvdXJjZUNvZGUsIG5vZGUpIHtcbiAgY29uc3QgdG9rZW5zVG9FbmRPZkxpbmUgPSB0YWtlVG9rZW5zQmVmb3JlV2hpbGUoc291cmNlQ29kZSwgbm9kZSwgY29tbWVudE9uU2FtZUxpbmVBcyhub2RlKSlcbiAgbGV0IHN0YXJ0T2ZUb2tlbnMgPSB0b2tlbnNUb0VuZE9mTGluZS5sZW5ndGggPiAwID8gdG9rZW5zVG9FbmRPZkxpbmVbMF0ucmFuZ2VbMF0gOiBub2RlLnJhbmdlWzBdXG4gIGxldCByZXN1bHQgPSBzdGFydE9mVG9rZW5zXG4gIGZvciAobGV0IGkgPSBzdGFydE9mVG9rZW5zIC0gMTsgaSA+IDA7IGktLSkge1xuICAgIGlmIChzb3VyY2VDb2RlLnRleHRbaV0gIT09ICcgJyAmJiBzb3VyY2VDb2RlLnRleHRbaV0gIT09ICdcXHQnKSB7XG4gICAgICBicmVha1xuICAgIH1cbiAgICByZXN1bHQgPSBpXG4gIH1cbiAgcmV0dXJuIHJlc3VsdFxufVxuXG5mdW5jdGlvbiBpc1BsYWluUmVxdWlyZU1vZHVsZShub2RlKSB7XG4gIGlmIChub2RlLnR5cGUgIT09ICdWYXJpYWJsZURlY2xhcmF0aW9uJykge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG4gIGlmIChub2RlLmRlY2xhcmF0aW9ucy5sZW5ndGggIT09IDEpIHtcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuICBjb25zdCBkZWNsID0gbm9kZS5kZWNsYXJhdGlvbnNbMF1cbiAgY29uc3QgcmVzdWx0ID0gZGVjbC5pZCAmJlxuICAgIChkZWNsLmlkLnR5cGUgPT09ICdJZGVudGlmaWVyJyB8fCBkZWNsLmlkLnR5cGUgPT09ICdPYmplY3RQYXR0ZXJuJykgJiZcbiAgICBkZWNsLmluaXQgIT0gbnVsbCAmJlxuICAgIGRlY2wuaW5pdC50eXBlID09PSAnQ2FsbEV4cHJlc3Npb24nICYmXG4gICAgZGVjbC5pbml0LmNhbGxlZSAhPSBudWxsICYmXG4gICAgZGVjbC5pbml0LmNhbGxlZS5uYW1lID09PSAncmVxdWlyZScgJiZcbiAgICBkZWNsLmluaXQuYXJndW1lbnRzICE9IG51bGwgJiZcbiAgICBkZWNsLmluaXQuYXJndW1lbnRzLmxlbmd0aCA9PT0gMSAmJlxuICAgIGRlY2wuaW5pdC5hcmd1bWVudHNbMF0udHlwZSA9PT0gJ0xpdGVyYWwnXG4gIHJldHVybiByZXN1bHRcbn1cblxuZnVuY3Rpb24gaXNQbGFpbkltcG9ydE1vZHVsZShub2RlKSB7XG4gIHJldHVybiBub2RlLnR5cGUgPT09ICdJbXBvcnREZWNsYXJhdGlvbicgJiYgbm9kZS5zcGVjaWZpZXJzICE9IG51bGwgJiYgbm9kZS5zcGVjaWZpZXJzLmxlbmd0aCA+IDBcbn1cblxuZnVuY3Rpb24gaXNQbGFpbkltcG9ydEVxdWFscyhub2RlKSB7XG4gIHJldHVybiBub2RlLnR5cGUgPT09ICdUU0ltcG9ydEVxdWFsc0RlY2xhcmF0aW9uJyAmJiBub2RlLm1vZHVsZVJlZmVyZW5jZS5leHByZXNzaW9uXG59XG5cbmZ1bmN0aW9uIGNhbkNyb3NzTm9kZVdoaWxlUmVvcmRlcihub2RlKSB7XG4gIHJldHVybiBpc1BsYWluUmVxdWlyZU1vZHVsZShub2RlKSB8fCBpc1BsYWluSW1wb3J0TW9kdWxlKG5vZGUpIHx8IGlzUGxhaW5JbXBvcnRFcXVhbHMobm9kZSlcbn1cblxuZnVuY3Rpb24gY2FuUmVvcmRlckl0ZW1zKGZpcnN0Tm9kZSwgc2Vjb25kTm9kZSkge1xuICBjb25zdCBwYXJlbnQgPSBmaXJzdE5vZGUucGFyZW50XG4gIGNvbnN0IFtmaXJzdEluZGV4LCBzZWNvbmRJbmRleF0gPSBbXG4gICAgcGFyZW50LmJvZHkuaW5kZXhPZihmaXJzdE5vZGUpLFxuICAgIHBhcmVudC5ib2R5LmluZGV4T2Yoc2Vjb25kTm9kZSksXG4gIF0uc29ydCgpXG4gIGNvbnN0IG5vZGVzQmV0d2VlbiA9IHBhcmVudC5ib2R5LnNsaWNlKGZpcnN0SW5kZXgsIHNlY29uZEluZGV4ICsgMSlcbiAgZm9yICh2YXIgbm9kZUJldHdlZW4gb2Ygbm9kZXNCZXR3ZWVuKSB7XG4gICAgaWYgKCFjYW5Dcm9zc05vZGVXaGlsZVJlb3JkZXIobm9kZUJldHdlZW4pKSB7XG4gICAgICByZXR1cm4gZmFsc2VcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHRydWVcbn1cblxuZnVuY3Rpb24gZml4T3V0T2ZPcmRlcihjb250ZXh0LCBmaXJzdE5vZGUsIHNlY29uZE5vZGUsIG9yZGVyKSB7XG4gIGNvbnN0IHNvdXJjZUNvZGUgPSBjb250ZXh0LmdldFNvdXJjZUNvZGUoKVxuXG4gIGNvbnN0IGZpcnN0Um9vdCA9IGZpbmRSb290Tm9kZShmaXJzdE5vZGUubm9kZSlcbiAgY29uc3QgZmlyc3RSb290U3RhcnQgPSBmaW5kU3RhcnRPZkxpbmVXaXRoQ29tbWVudHMoc291cmNlQ29kZSwgZmlyc3RSb290KVxuICBjb25zdCBmaXJzdFJvb3RFbmQgPSBmaW5kRW5kT2ZMaW5lV2l0aENvbW1lbnRzKHNvdXJjZUNvZGUsIGZpcnN0Um9vdClcblxuICBjb25zdCBzZWNvbmRSb290ID0gZmluZFJvb3ROb2RlKHNlY29uZE5vZGUubm9kZSlcbiAgY29uc3Qgc2Vjb25kUm9vdFN0YXJ0ID0gZmluZFN0YXJ0T2ZMaW5lV2l0aENvbW1lbnRzKHNvdXJjZUNvZGUsIHNlY29uZFJvb3QpXG4gIGNvbnN0IHNlY29uZFJvb3RFbmQgPSBmaW5kRW5kT2ZMaW5lV2l0aENvbW1lbnRzKHNvdXJjZUNvZGUsIHNlY29uZFJvb3QpXG4gIGNvbnN0IGNhbkZpeCA9IGNhblJlb3JkZXJJdGVtcyhmaXJzdFJvb3QsIHNlY29uZFJvb3QpXG5cbiAgbGV0IG5ld0NvZGUgPSBzb3VyY2VDb2RlLnRleHQuc3Vic3RyaW5nKHNlY29uZFJvb3RTdGFydCwgc2Vjb25kUm9vdEVuZClcbiAgaWYgKG5ld0NvZGVbbmV3Q29kZS5sZW5ndGggLSAxXSAhPT0gJ1xcbicpIHtcbiAgICBuZXdDb2RlID0gbmV3Q29kZSArICdcXG4nXG4gIH1cblxuICBjb25zdCBtZXNzYWdlID0gYFxcYCR7c2Vjb25kTm9kZS5kaXNwbGF5TmFtZX1cXGAgaW1wb3J0IHNob3VsZCBvY2N1ciAke29yZGVyfSBpbXBvcnQgb2YgXFxgJHtmaXJzdE5vZGUuZGlzcGxheU5hbWV9XFxgYFxuXG4gIGlmIChvcmRlciA9PT0gJ2JlZm9yZScpIHtcbiAgICBjb250ZXh0LnJlcG9ydCh7XG4gICAgICBub2RlOiBzZWNvbmROb2RlLm5vZGUsXG4gICAgICBtZXNzYWdlOiBtZXNzYWdlLFxuICAgICAgZml4OiBjYW5GaXggJiYgKGZpeGVyID0+XG4gICAgICAgIGZpeGVyLnJlcGxhY2VUZXh0UmFuZ2UoXG4gICAgICAgICAgW2ZpcnN0Um9vdFN0YXJ0LCBzZWNvbmRSb290RW5kXSxcbiAgICAgICAgICBuZXdDb2RlICsgc291cmNlQ29kZS50ZXh0LnN1YnN0cmluZyhmaXJzdFJvb3RTdGFydCwgc2Vjb25kUm9vdFN0YXJ0KVxuICAgICAgICApKSxcbiAgICB9KVxuICB9IGVsc2UgaWYgKG9yZGVyID09PSAnYWZ0ZXInKSB7XG4gICAgY29udGV4dC5yZXBvcnQoe1xuICAgICAgbm9kZTogc2Vjb25kTm9kZS5ub2RlLFxuICAgICAgbWVzc2FnZTogbWVzc2FnZSxcbiAgICAgIGZpeDogY2FuRml4ICYmIChmaXhlciA9PlxuICAgICAgICBmaXhlci5yZXBsYWNlVGV4dFJhbmdlKFxuICAgICAgICAgIFtzZWNvbmRSb290U3RhcnQsIGZpcnN0Um9vdEVuZF0sXG4gICAgICAgICAgc291cmNlQ29kZS50ZXh0LnN1YnN0cmluZyhzZWNvbmRSb290RW5kLCBmaXJzdFJvb3RFbmQpICsgbmV3Q29kZVxuICAgICAgICApKSxcbiAgICB9KVxuICB9XG59XG5cbmZ1bmN0aW9uIHJlcG9ydE91dE9mT3JkZXIoY29udGV4dCwgaW1wb3J0ZWQsIG91dE9mT3JkZXIsIG9yZGVyKSB7XG4gIG91dE9mT3JkZXIuZm9yRWFjaChmdW5jdGlvbiAoaW1wKSB7XG4gICAgY29uc3QgZm91bmQgPSBpbXBvcnRlZC5maW5kKGZ1bmN0aW9uIGhhc0hpZ2hlclJhbmsoaW1wb3J0ZWRJdGVtKSB7XG4gICAgICByZXR1cm4gaW1wb3J0ZWRJdGVtLnJhbmsgPiBpbXAucmFua1xuICAgIH0pXG4gICAgZml4T3V0T2ZPcmRlcihjb250ZXh0LCBmb3VuZCwgaW1wLCBvcmRlcilcbiAgfSlcbn1cblxuZnVuY3Rpb24gbWFrZU91dE9mT3JkZXJSZXBvcnQoY29udGV4dCwgaW1wb3J0ZWQpIHtcbiAgY29uc3Qgb3V0T2ZPcmRlciA9IGZpbmRPdXRPZk9yZGVyKGltcG9ydGVkKVxuICBpZiAoIW91dE9mT3JkZXIubGVuZ3RoKSB7XG4gICAgcmV0dXJuXG4gIH1cbiAgLy8gVGhlcmUgYXJlIHRoaW5ncyB0byByZXBvcnQuIFRyeSB0byBtaW5pbWl6ZSB0aGUgbnVtYmVyIG9mIHJlcG9ydGVkIGVycm9ycy5cbiAgY29uc3QgcmV2ZXJzZWRJbXBvcnRlZCA9IHJldmVyc2UoaW1wb3J0ZWQpXG4gIGNvbnN0IHJldmVyc2VkT3JkZXIgPSBmaW5kT3V0T2ZPcmRlcihyZXZlcnNlZEltcG9ydGVkKVxuICBpZiAocmV2ZXJzZWRPcmRlci5sZW5ndGggPCBvdXRPZk9yZGVyLmxlbmd0aCkge1xuICAgIHJlcG9ydE91dE9mT3JkZXIoY29udGV4dCwgcmV2ZXJzZWRJbXBvcnRlZCwgcmV2ZXJzZWRPcmRlciwgJ2FmdGVyJylcbiAgICByZXR1cm5cbiAgfVxuICByZXBvcnRPdXRPZk9yZGVyKGNvbnRleHQsIGltcG9ydGVkLCBvdXRPZk9yZGVyLCAnYmVmb3JlJylcbn1cblxuZnVuY3Rpb24gZ2V0U29ydGVyKGFzY2VuZGluZykge1xuICBjb25zdCBtdWx0aXBsaWVyID0gYXNjZW5kaW5nID8gMSA6IC0xXG5cbiAgcmV0dXJuIGZ1bmN0aW9uIGltcG9ydHNTb3J0ZXIoaW1wb3J0QSwgaW1wb3J0Qikge1xuICAgIGxldCByZXN1bHRcblxuICAgIGlmIChpbXBvcnRBIDwgaW1wb3J0Qikge1xuICAgICAgcmVzdWx0ID0gLTFcbiAgICB9IGVsc2UgaWYgKGltcG9ydEEgPiBpbXBvcnRCKSB7XG4gICAgICByZXN1bHQgPSAxXG4gICAgfSBlbHNlIHtcbiAgICAgIHJlc3VsdCA9IDBcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0ICogbXVsdGlwbGllclxuICB9XG59XG5cbmZ1bmN0aW9uIG11dGF0ZVJhbmtzVG9BbHBoYWJldGl6ZShpbXBvcnRlZCwgYWxwaGFiZXRpemVPcHRpb25zKSB7XG4gIGNvbnN0IGdyb3VwZWRCeVJhbmtzID0gaW1wb3J0ZWQucmVkdWNlKGZ1bmN0aW9uKGFjYywgaW1wb3J0ZWRJdGVtKSB7XG4gICAgaWYgKCFBcnJheS5pc0FycmF5KGFjY1tpbXBvcnRlZEl0ZW0ucmFua10pKSB7XG4gICAgICBhY2NbaW1wb3J0ZWRJdGVtLnJhbmtdID0gW11cbiAgICB9XG4gICAgYWNjW2ltcG9ydGVkSXRlbS5yYW5rXS5wdXNoKGltcG9ydGVkSXRlbS52YWx1ZSlcbiAgICByZXR1cm4gYWNjXG4gIH0sIHt9KVxuXG4gIGNvbnN0IGdyb3VwUmFua3MgPSBPYmplY3Qua2V5cyhncm91cGVkQnlSYW5rcylcblxuICBjb25zdCBzb3J0ZXJGbiA9IGdldFNvcnRlcihhbHBoYWJldGl6ZU9wdGlvbnMub3JkZXIgPT09ICdhc2MnKVxuICBjb25zdCBjb21wYXJhdG9yID0gYWxwaGFiZXRpemVPcHRpb25zLmNhc2VJbnNlbnNpdGl2ZSA/IChhLCBiKSA9PiBzb3J0ZXJGbihTdHJpbmcoYSkudG9Mb3dlckNhc2UoKSwgU3RyaW5nKGIpLnRvTG93ZXJDYXNlKCkpIDogKGEsIGIpID0+IHNvcnRlckZuKGEsIGIpXG4gIC8vIHNvcnQgaW1wb3J0cyBsb2NhbGx5IHdpdGhpbiB0aGVpciBncm91cFxuICBncm91cFJhbmtzLmZvckVhY2goZnVuY3Rpb24oZ3JvdXBSYW5rKSB7XG4gICAgZ3JvdXBlZEJ5UmFua3NbZ3JvdXBSYW5rXS5zb3J0KGNvbXBhcmF0b3IpXG4gIH0pXG5cbiAgLy8gYXNzaWduIGdsb2JhbGx5IHVuaXF1ZSByYW5rIHRvIGVhY2ggaW1wb3J0XG4gIGxldCBuZXdSYW5rID0gMFxuICBjb25zdCBhbHBoYWJldGl6ZWRSYW5rcyA9IGdyb3VwUmFua3Muc29ydCgpLnJlZHVjZShmdW5jdGlvbihhY2MsIGdyb3VwUmFuaykge1xuICAgIGdyb3VwZWRCeVJhbmtzW2dyb3VwUmFua10uZm9yRWFjaChmdW5jdGlvbihpbXBvcnRlZEl0ZW1OYW1lKSB7XG4gICAgICBhY2NbaW1wb3J0ZWRJdGVtTmFtZV0gPSBwYXJzZUludChncm91cFJhbmssIDEwKSArIG5ld1JhbmtcbiAgICAgIG5ld1JhbmsgKz0gMVxuICAgIH0pXG4gICAgcmV0dXJuIGFjY1xuICB9LCB7fSlcblxuICAvLyBtdXRhdGUgdGhlIG9yaWdpbmFsIGdyb3VwLXJhbmsgd2l0aCBhbHBoYWJldGl6ZWQtcmFua1xuICBpbXBvcnRlZC5mb3JFYWNoKGZ1bmN0aW9uKGltcG9ydGVkSXRlbSkge1xuICAgIGltcG9ydGVkSXRlbS5yYW5rID0gYWxwaGFiZXRpemVkUmFua3NbaW1wb3J0ZWRJdGVtLnZhbHVlXVxuICB9KVxufVxuXG4vLyBERVRFQ1RJTkdcblxuZnVuY3Rpb24gY29tcHV0ZVBhdGhSYW5rKHJhbmtzLCBwYXRoR3JvdXBzLCBwYXRoLCBtYXhQb3NpdGlvbikge1xuICBmb3IgKGxldCBpID0gMCwgbCA9IHBhdGhHcm91cHMubGVuZ3RoOyBpIDwgbDsgaSsrKSB7XG4gICAgY29uc3QgeyBwYXR0ZXJuLCBwYXR0ZXJuT3B0aW9ucywgZ3JvdXAsIHBvc2l0aW9uID0gMSB9ID0gcGF0aEdyb3Vwc1tpXVxuICAgIGlmIChtaW5pbWF0Y2gocGF0aCwgcGF0dGVybiwgcGF0dGVybk9wdGlvbnMgfHwgeyBub2NvbW1lbnQ6IHRydWUgfSkpIHtcbiAgICAgIHJldHVybiByYW5rc1tncm91cF0gKyAocG9zaXRpb24gLyBtYXhQb3NpdGlvbilcbiAgICB9XG4gIH1cbn1cblxuZnVuY3Rpb24gY29tcHV0ZVJhbmsoY29udGV4dCwgcmFua3MsIGltcG9ydEVudHJ5LCBleGNsdWRlZEltcG9ydFR5cGVzKSB7XG4gIGxldCBpbXBUeXBlXG4gIGxldCByYW5rXG4gIGlmIChpbXBvcnRFbnRyeS50eXBlID09PSAnaW1wb3J0Om9iamVjdCcpIHtcbiAgICBpbXBUeXBlID0gJ29iamVjdCdcbiAgfSBlbHNlIHtcbiAgICBpbXBUeXBlID0gaW1wb3J0VHlwZShpbXBvcnRFbnRyeS52YWx1ZSwgY29udGV4dClcbiAgfVxuICBpZiAoIWV4Y2x1ZGVkSW1wb3J0VHlwZXMuaGFzKGltcFR5cGUpKSB7XG4gICAgcmFuayA9IGNvbXB1dGVQYXRoUmFuayhyYW5rcy5ncm91cHMsIHJhbmtzLnBhdGhHcm91cHMsIGltcG9ydEVudHJ5LnZhbHVlLCByYW5rcy5tYXhQb3NpdGlvbilcbiAgfVxuICBpZiAodHlwZW9mIHJhbmsgPT09ICd1bmRlZmluZWQnKSB7XG4gICAgcmFuayA9IHJhbmtzLmdyb3Vwc1tpbXBUeXBlXVxuICB9XG4gIGlmIChpbXBvcnRFbnRyeS50eXBlICE9PSAnaW1wb3J0JyAmJiAhaW1wb3J0RW50cnkudHlwZS5zdGFydHNXaXRoKCdpbXBvcnQ6JykpIHtcbiAgICByYW5rICs9IDEwMFxuICB9XG5cbiAgcmV0dXJuIHJhbmtcbn1cblxuZnVuY3Rpb24gcmVnaXN0ZXJOb2RlKGNvbnRleHQsIGltcG9ydEVudHJ5LCByYW5rcywgaW1wb3J0ZWQsIGV4Y2x1ZGVkSW1wb3J0VHlwZXMpIHtcbiAgY29uc3QgcmFuayA9IGNvbXB1dGVSYW5rKGNvbnRleHQsIHJhbmtzLCBpbXBvcnRFbnRyeSwgZXhjbHVkZWRJbXBvcnRUeXBlcylcbiAgaWYgKHJhbmsgIT09IC0xKSB7XG4gICAgaW1wb3J0ZWQucHVzaChPYmplY3QuYXNzaWduKHt9LCBpbXBvcnRFbnRyeSwgeyByYW5rIH0pKVxuICB9XG59XG5cbmZ1bmN0aW9uIGlzTW9kdWxlTGV2ZWxSZXF1aXJlKG5vZGUpIHtcbiAgbGV0IG4gPSBub2RlXG4gIC8vIEhhbmRsZSBjYXNlcyBsaWtlIGBjb25zdCBiYXogPSByZXF1aXJlKCdmb28nKS5iYXIuYmF6YFxuICAvLyBhbmQgYGNvbnN0IGZvbyA9IHJlcXVpcmUoJ2ZvbycpKClgXG4gIHdoaWxlICggXG4gICAgKG4ucGFyZW50LnR5cGUgPT09ICdNZW1iZXJFeHByZXNzaW9uJyAmJiBuLnBhcmVudC5vYmplY3QgPT09IG4pIHx8XG4gICAgKG4ucGFyZW50LnR5cGUgPT09ICdDYWxsRXhwcmVzc2lvbicgJiYgbi5wYXJlbnQuY2FsbGVlID09PSBuKVxuICAgKSB7XG4gICAgbiA9IG4ucGFyZW50XG4gIH1cbiAgcmV0dXJuIChcbiAgICBuLnBhcmVudC50eXBlID09PSAnVmFyaWFibGVEZWNsYXJhdG9yJyAmJlxuICAgIG4ucGFyZW50LnBhcmVudC50eXBlID09PSAnVmFyaWFibGVEZWNsYXJhdGlvbicgJiZcbiAgICBuLnBhcmVudC5wYXJlbnQucGFyZW50LnR5cGUgPT09ICdQcm9ncmFtJyBcbiAgKVxufVxuXG5jb25zdCB0eXBlcyA9IFsnYnVpbHRpbicsICdleHRlcm5hbCcsICdpbnRlcm5hbCcsICd1bmtub3duJywgJ3BhcmVudCcsICdzaWJsaW5nJywgJ2luZGV4JywgJ29iamVjdCddXG5cbi8vIENyZWF0ZXMgYW4gb2JqZWN0IHdpdGggdHlwZS1yYW5rIHBhaXJzLlxuLy8gRXhhbXBsZTogeyBpbmRleDogMCwgc2libGluZzogMSwgcGFyZW50OiAxLCBleHRlcm5hbDogMSwgYnVpbHRpbjogMiwgaW50ZXJuYWw6IDIgfVxuLy8gV2lsbCB0aHJvdyBhbiBlcnJvciBpZiBpdCBjb250YWlucyBhIHR5cGUgdGhhdCBkb2VzIG5vdCBleGlzdCwgb3IgaGFzIGEgZHVwbGljYXRlXG5mdW5jdGlvbiBjb252ZXJ0R3JvdXBzVG9SYW5rcyhncm91cHMpIHtcbiAgY29uc3QgcmFua09iamVjdCA9IGdyb3Vwcy5yZWR1Y2UoZnVuY3Rpb24ocmVzLCBncm91cCwgaW5kZXgpIHtcbiAgICBpZiAodHlwZW9mIGdyb3VwID09PSAnc3RyaW5nJykge1xuICAgICAgZ3JvdXAgPSBbZ3JvdXBdXG4gICAgfVxuICAgIGdyb3VwLmZvckVhY2goZnVuY3Rpb24oZ3JvdXBJdGVtKSB7XG4gICAgICBpZiAodHlwZXMuaW5kZXhPZihncm91cEl0ZW0pID09PSAtMSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0luY29ycmVjdCBjb25maWd1cmF0aW9uIG9mIHRoZSBydWxlOiBVbmtub3duIHR5cGUgYCcgK1xuICAgICAgICAgIEpTT04uc3RyaW5naWZ5KGdyb3VwSXRlbSkgKyAnYCcpXG4gICAgICB9XG4gICAgICBpZiAocmVzW2dyb3VwSXRlbV0gIT09IHVuZGVmaW5lZCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0luY29ycmVjdCBjb25maWd1cmF0aW9uIG9mIHRoZSBydWxlOiBgJyArIGdyb3VwSXRlbSArICdgIGlzIGR1cGxpY2F0ZWQnKVxuICAgICAgfVxuICAgICAgcmVzW2dyb3VwSXRlbV0gPSBpbmRleFxuICAgIH0pXG4gICAgcmV0dXJuIHJlc1xuICB9LCB7fSlcblxuICBjb25zdCBvbWl0dGVkVHlwZXMgPSB0eXBlcy5maWx0ZXIoZnVuY3Rpb24odHlwZSkge1xuICAgIHJldHVybiByYW5rT2JqZWN0W3R5cGVdID09PSB1bmRlZmluZWRcbiAgfSlcblxuICByZXR1cm4gb21pdHRlZFR5cGVzLnJlZHVjZShmdW5jdGlvbihyZXMsIHR5cGUpIHtcbiAgICByZXNbdHlwZV0gPSBncm91cHMubGVuZ3RoXG4gICAgcmV0dXJuIHJlc1xuICB9LCByYW5rT2JqZWN0KVxufVxuXG5mdW5jdGlvbiBjb252ZXJ0UGF0aEdyb3Vwc0ZvclJhbmtzKHBhdGhHcm91cHMpIHtcbiAgY29uc3QgYWZ0ZXIgPSB7fVxuICBjb25zdCBiZWZvcmUgPSB7fVxuXG4gIGNvbnN0IHRyYW5zZm9ybWVkID0gcGF0aEdyb3Vwcy5tYXAoKHBhdGhHcm91cCwgaW5kZXgpID0+IHtcbiAgICBjb25zdCB7IGdyb3VwLCBwb3NpdGlvbjogcG9zaXRpb25TdHJpbmcgfSA9IHBhdGhHcm91cFxuICAgIGxldCBwb3NpdGlvbiA9IDBcbiAgICBpZiAocG9zaXRpb25TdHJpbmcgPT09ICdhZnRlcicpIHtcbiAgICAgIGlmICghYWZ0ZXJbZ3JvdXBdKSB7XG4gICAgICAgIGFmdGVyW2dyb3VwXSA9IDFcbiAgICAgIH1cbiAgICAgIHBvc2l0aW9uID0gYWZ0ZXJbZ3JvdXBdKytcbiAgICB9IGVsc2UgaWYgKHBvc2l0aW9uU3RyaW5nID09PSAnYmVmb3JlJykge1xuICAgICAgaWYgKCFiZWZvcmVbZ3JvdXBdKSB7XG4gICAgICAgIGJlZm9yZVtncm91cF0gPSBbXVxuICAgICAgfVxuICAgICAgYmVmb3JlW2dyb3VwXS5wdXNoKGluZGV4KVxuICAgIH1cblxuICAgIHJldHVybiBPYmplY3QuYXNzaWduKHt9LCBwYXRoR3JvdXAsIHsgcG9zaXRpb24gfSlcbiAgfSlcblxuICBsZXQgbWF4UG9zaXRpb24gPSAxXG5cbiAgT2JqZWN0LmtleXMoYmVmb3JlKS5mb3JFYWNoKChncm91cCkgPT4ge1xuICAgIGNvbnN0IGdyb3VwTGVuZ3RoID0gYmVmb3JlW2dyb3VwXS5sZW5ndGhcbiAgICBiZWZvcmVbZ3JvdXBdLmZvckVhY2goKGdyb3VwSW5kZXgsIGluZGV4KSA9PiB7XG4gICAgICB0cmFuc2Zvcm1lZFtncm91cEluZGV4XS5wb3NpdGlvbiA9IC0xICogKGdyb3VwTGVuZ3RoIC0gaW5kZXgpXG4gICAgfSlcbiAgICBtYXhQb3NpdGlvbiA9IE1hdGgubWF4KG1heFBvc2l0aW9uLCBncm91cExlbmd0aClcbiAgfSlcblxuICBPYmplY3Qua2V5cyhhZnRlcikuZm9yRWFjaCgoa2V5KSA9PiB7XG4gICAgY29uc3QgZ3JvdXBOZXh0UG9zaXRpb24gPSBhZnRlcltrZXldXG4gICAgbWF4UG9zaXRpb24gPSBNYXRoLm1heChtYXhQb3NpdGlvbiwgZ3JvdXBOZXh0UG9zaXRpb24gLSAxKVxuICB9KVxuXG4gIHJldHVybiB7XG4gICAgcGF0aEdyb3VwczogdHJhbnNmb3JtZWQsXG4gICAgbWF4UG9zaXRpb246IG1heFBvc2l0aW9uID4gMTAgPyBNYXRoLnBvdygxMCwgTWF0aC5jZWlsKE1hdGgubG9nMTAobWF4UG9zaXRpb24pKSkgOiAxMCxcbiAgfVxufVxuXG5mdW5jdGlvbiBmaXhOZXdMaW5lQWZ0ZXJJbXBvcnQoY29udGV4dCwgcHJldmlvdXNJbXBvcnQpIHtcbiAgY29uc3QgcHJldlJvb3QgPSBmaW5kUm9vdE5vZGUocHJldmlvdXNJbXBvcnQubm9kZSlcbiAgY29uc3QgdG9rZW5zVG9FbmRPZkxpbmUgPSB0YWtlVG9rZW5zQWZ0ZXJXaGlsZShcbiAgICBjb250ZXh0LmdldFNvdXJjZUNvZGUoKSwgcHJldlJvb3QsIGNvbW1lbnRPblNhbWVMaW5lQXMocHJldlJvb3QpKVxuXG4gIGxldCBlbmRPZkxpbmUgPSBwcmV2Um9vdC5yYW5nZVsxXVxuICBpZiAodG9rZW5zVG9FbmRPZkxpbmUubGVuZ3RoID4gMCkge1xuICAgIGVuZE9mTGluZSA9IHRva2Vuc1RvRW5kT2ZMaW5lW3Rva2Vuc1RvRW5kT2ZMaW5lLmxlbmd0aCAtIDFdLnJhbmdlWzFdXG4gIH1cbiAgcmV0dXJuIChmaXhlcikgPT4gZml4ZXIuaW5zZXJ0VGV4dEFmdGVyUmFuZ2UoW3ByZXZSb290LnJhbmdlWzBdLCBlbmRPZkxpbmVdLCAnXFxuJylcbn1cblxuZnVuY3Rpb24gcmVtb3ZlTmV3TGluZUFmdGVySW1wb3J0KGNvbnRleHQsIGN1cnJlbnRJbXBvcnQsIHByZXZpb3VzSW1wb3J0KSB7XG4gIGNvbnN0IHNvdXJjZUNvZGUgPSBjb250ZXh0LmdldFNvdXJjZUNvZGUoKVxuICBjb25zdCBwcmV2Um9vdCA9IGZpbmRSb290Tm9kZShwcmV2aW91c0ltcG9ydC5ub2RlKVxuICBjb25zdCBjdXJyUm9vdCA9IGZpbmRSb290Tm9kZShjdXJyZW50SW1wb3J0Lm5vZGUpXG4gIGNvbnN0IHJhbmdlVG9SZW1vdmUgPSBbXG4gICAgZmluZEVuZE9mTGluZVdpdGhDb21tZW50cyhzb3VyY2VDb2RlLCBwcmV2Um9vdCksXG4gICAgZmluZFN0YXJ0T2ZMaW5lV2l0aENvbW1lbnRzKHNvdXJjZUNvZGUsIGN1cnJSb290KSxcbiAgXVxuICBpZiAoL15cXHMqJC8udGVzdChzb3VyY2VDb2RlLnRleHQuc3Vic3RyaW5nKHJhbmdlVG9SZW1vdmVbMF0sIHJhbmdlVG9SZW1vdmVbMV0pKSkge1xuICAgIHJldHVybiAoZml4ZXIpID0+IGZpeGVyLnJlbW92ZVJhbmdlKHJhbmdlVG9SZW1vdmUpXG4gIH1cbiAgcmV0dXJuIHVuZGVmaW5lZFxufVxuXG5mdW5jdGlvbiBtYWtlTmV3bGluZXNCZXR3ZWVuUmVwb3J0IChjb250ZXh0LCBpbXBvcnRlZCwgbmV3bGluZXNCZXR3ZWVuSW1wb3J0cykge1xuICBjb25zdCBnZXROdW1iZXJPZkVtcHR5TGluZXNCZXR3ZWVuID0gKGN1cnJlbnRJbXBvcnQsIHByZXZpb3VzSW1wb3J0KSA9PiB7XG4gICAgY29uc3QgbGluZXNCZXR3ZWVuSW1wb3J0cyA9IGNvbnRleHQuZ2V0U291cmNlQ29kZSgpLmxpbmVzLnNsaWNlKFxuICAgICAgcHJldmlvdXNJbXBvcnQubm9kZS5sb2MuZW5kLmxpbmUsXG4gICAgICBjdXJyZW50SW1wb3J0Lm5vZGUubG9jLnN0YXJ0LmxpbmUgLSAxXG4gICAgKVxuXG4gICAgcmV0dXJuIGxpbmVzQmV0d2VlbkltcG9ydHMuZmlsdGVyKChsaW5lKSA9PiAhbGluZS50cmltKCkubGVuZ3RoKS5sZW5ndGhcbiAgfVxuICBsZXQgcHJldmlvdXNJbXBvcnQgPSBpbXBvcnRlZFswXVxuXG4gIGltcG9ydGVkLnNsaWNlKDEpLmZvckVhY2goZnVuY3Rpb24oY3VycmVudEltcG9ydCkge1xuICAgIGNvbnN0IGVtcHR5TGluZXNCZXR3ZWVuID0gZ2V0TnVtYmVyT2ZFbXB0eUxpbmVzQmV0d2VlbihjdXJyZW50SW1wb3J0LCBwcmV2aW91c0ltcG9ydClcblxuICAgIGlmIChuZXdsaW5lc0JldHdlZW5JbXBvcnRzID09PSAnYWx3YXlzJ1xuICAgICAgICB8fCBuZXdsaW5lc0JldHdlZW5JbXBvcnRzID09PSAnYWx3YXlzLWFuZC1pbnNpZGUtZ3JvdXBzJykge1xuICAgICAgaWYgKGN1cnJlbnRJbXBvcnQucmFuayAhPT0gcHJldmlvdXNJbXBvcnQucmFuayAmJiBlbXB0eUxpbmVzQmV0d2VlbiA9PT0gMCkge1xuICAgICAgICBjb250ZXh0LnJlcG9ydCh7XG4gICAgICAgICAgbm9kZTogcHJldmlvdXNJbXBvcnQubm9kZSxcbiAgICAgICAgICBtZXNzYWdlOiAnVGhlcmUgc2hvdWxkIGJlIGF0IGxlYXN0IG9uZSBlbXB0eSBsaW5lIGJldHdlZW4gaW1wb3J0IGdyb3VwcycsXG4gICAgICAgICAgZml4OiBmaXhOZXdMaW5lQWZ0ZXJJbXBvcnQoY29udGV4dCwgcHJldmlvdXNJbXBvcnQpLFxuICAgICAgICB9KVxuICAgICAgfSBlbHNlIGlmIChjdXJyZW50SW1wb3J0LnJhbmsgPT09IHByZXZpb3VzSW1wb3J0LnJhbmtcbiAgICAgICAgJiYgZW1wdHlMaW5lc0JldHdlZW4gPiAwXG4gICAgICAgICYmIG5ld2xpbmVzQmV0d2VlbkltcG9ydHMgIT09ICdhbHdheXMtYW5kLWluc2lkZS1ncm91cHMnKSB7XG4gICAgICAgIGNvbnRleHQucmVwb3J0KHtcbiAgICAgICAgICBub2RlOiBwcmV2aW91c0ltcG9ydC5ub2RlLFxuICAgICAgICAgIG1lc3NhZ2U6ICdUaGVyZSBzaG91bGQgYmUgbm8gZW1wdHkgbGluZSB3aXRoaW4gaW1wb3J0IGdyb3VwJyxcbiAgICAgICAgICBmaXg6IHJlbW92ZU5ld0xpbmVBZnRlckltcG9ydChjb250ZXh0LCBjdXJyZW50SW1wb3J0LCBwcmV2aW91c0ltcG9ydCksXG4gICAgICAgIH0pXG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChlbXB0eUxpbmVzQmV0d2VlbiA+IDApIHtcbiAgICAgIGNvbnRleHQucmVwb3J0KHtcbiAgICAgICAgbm9kZTogcHJldmlvdXNJbXBvcnQubm9kZSxcbiAgICAgICAgbWVzc2FnZTogJ1RoZXJlIHNob3VsZCBiZSBubyBlbXB0eSBsaW5lIGJldHdlZW4gaW1wb3J0IGdyb3VwcycsXG4gICAgICAgIGZpeDogcmVtb3ZlTmV3TGluZUFmdGVySW1wb3J0KGNvbnRleHQsIGN1cnJlbnRJbXBvcnQsIHByZXZpb3VzSW1wb3J0KSxcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgcHJldmlvdXNJbXBvcnQgPSBjdXJyZW50SW1wb3J0XG4gIH0pXG59XG5cbmZ1bmN0aW9uIGdldEFscGhhYmV0aXplQ29uZmlnKG9wdGlvbnMpIHtcbiAgY29uc3QgYWxwaGFiZXRpemUgPSBvcHRpb25zLmFscGhhYmV0aXplIHx8IHt9XG4gIGNvbnN0IG9yZGVyID0gYWxwaGFiZXRpemUub3JkZXIgfHwgJ2lnbm9yZSdcbiAgY29uc3QgY2FzZUluc2Vuc2l0aXZlID0gYWxwaGFiZXRpemUuY2FzZUluc2Vuc2l0aXZlIHx8IGZhbHNlXG5cbiAgcmV0dXJuIHtvcmRlciwgY2FzZUluc2Vuc2l0aXZlfVxufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgbWV0YToge1xuICAgIHR5cGU6ICdzdWdnZXN0aW9uJyxcbiAgICBkb2NzOiB7XG4gICAgICB1cmw6IGRvY3NVcmwoJ29yZGVyJyksXG4gICAgfSxcblxuICAgIGZpeGFibGU6ICdjb2RlJyxcbiAgICBzY2hlbWE6IFtcbiAgICAgIHtcbiAgICAgICAgdHlwZTogJ29iamVjdCcsXG4gICAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgICBncm91cHM6IHtcbiAgICAgICAgICAgIHR5cGU6ICdhcnJheScsXG4gICAgICAgICAgfSxcbiAgICAgICAgICBwYXRoR3JvdXBzRXhjbHVkZWRJbXBvcnRUeXBlczoge1xuICAgICAgICAgICAgdHlwZTogJ2FycmF5JyxcbiAgICAgICAgICB9LFxuICAgICAgICAgIHBhdGhHcm91cHM6IHtcbiAgICAgICAgICAgIHR5cGU6ICdhcnJheScsXG4gICAgICAgICAgICBpdGVtczoge1xuICAgICAgICAgICAgICB0eXBlOiAnb2JqZWN0JyxcbiAgICAgICAgICAgICAgcHJvcGVydGllczoge1xuICAgICAgICAgICAgICAgIHBhdHRlcm46IHtcbiAgICAgICAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgcGF0dGVybk9wdGlvbnM6IHtcbiAgICAgICAgICAgICAgICAgIHR5cGU6ICdvYmplY3QnLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgZ3JvdXA6IHtcbiAgICAgICAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICAgICAgICAgICAgZW51bTogdHlwZXMsXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBwb3NpdGlvbjoge1xuICAgICAgICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgICAgICAgICAgICBlbnVtOiBbJ2FmdGVyJywgJ2JlZm9yZSddLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIHJlcXVpcmVkOiBbJ3BhdHRlcm4nLCAnZ3JvdXAnXSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICAnbmV3bGluZXMtYmV0d2Vlbic6IHtcbiAgICAgICAgICAgIGVudW06IFtcbiAgICAgICAgICAgICAgJ2lnbm9yZScsXG4gICAgICAgICAgICAgICdhbHdheXMnLFxuICAgICAgICAgICAgICAnYWx3YXlzLWFuZC1pbnNpZGUtZ3JvdXBzJyxcbiAgICAgICAgICAgICAgJ25ldmVyJyxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICBhbHBoYWJldGl6ZToge1xuICAgICAgICAgICAgdHlwZTogJ29iamVjdCcsXG4gICAgICAgICAgICBwcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgICAgIGNhc2VJbnNlbnNpdGl2ZToge1xuICAgICAgICAgICAgICAgIHR5cGU6ICdib29sZWFuJyxcbiAgICAgICAgICAgICAgICBkZWZhdWx0OiBmYWxzZSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgb3JkZXI6IHtcbiAgICAgICAgICAgICAgICBlbnVtOiBbJ2lnbm9yZScsICdhc2MnLCAnZGVzYyddLFxuICAgICAgICAgICAgICAgIGRlZmF1bHQ6ICdpZ25vcmUnLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGFkZGl0aW9uYWxQcm9wZXJ0aWVzOiBmYWxzZSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgICBhZGRpdGlvbmFsUHJvcGVydGllczogZmFsc2UsXG4gICAgICB9LFxuICAgIF0sXG4gIH0sXG5cbiAgY3JlYXRlOiBmdW5jdGlvbiBpbXBvcnRPcmRlclJ1bGUgKGNvbnRleHQpIHtcbiAgICBjb25zdCBvcHRpb25zID0gY29udGV4dC5vcHRpb25zWzBdIHx8IHt9XG4gICAgY29uc3QgbmV3bGluZXNCZXR3ZWVuSW1wb3J0cyA9IG9wdGlvbnNbJ25ld2xpbmVzLWJldHdlZW4nXSB8fCAnaWdub3JlJ1xuICAgIGNvbnN0IHBhdGhHcm91cHNFeGNsdWRlZEltcG9ydFR5cGVzID0gbmV3IFNldChvcHRpb25zWydwYXRoR3JvdXBzRXhjbHVkZWRJbXBvcnRUeXBlcyddIHx8IFsnYnVpbHRpbicsICdleHRlcm5hbCcsICdvYmplY3QnXSlcbiAgICBjb25zdCBhbHBoYWJldGl6ZSA9IGdldEFscGhhYmV0aXplQ29uZmlnKG9wdGlvbnMpXG4gICAgbGV0IHJhbmtzXG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgeyBwYXRoR3JvdXBzLCBtYXhQb3NpdGlvbiB9ID0gY29udmVydFBhdGhHcm91cHNGb3JSYW5rcyhvcHRpb25zLnBhdGhHcm91cHMgfHwgW10pXG4gICAgICByYW5rcyA9IHtcbiAgICAgICAgZ3JvdXBzOiBjb252ZXJ0R3JvdXBzVG9SYW5rcyhvcHRpb25zLmdyb3VwcyB8fCBkZWZhdWx0R3JvdXBzKSxcbiAgICAgICAgcGF0aEdyb3VwcyxcbiAgICAgICAgbWF4UG9zaXRpb24sXG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIC8vIE1hbGZvcm1lZCBjb25maWd1cmF0aW9uXG4gICAgICByZXR1cm4ge1xuICAgICAgICBQcm9ncmFtOiBmdW5jdGlvbihub2RlKSB7XG4gICAgICAgICAgY29udGV4dC5yZXBvcnQobm9kZSwgZXJyb3IubWVzc2FnZSlcbiAgICAgICAgfSxcbiAgICAgIH1cbiAgICB9XG4gICAgbGV0IGltcG9ydGVkID0gW11cblxuICAgIHJldHVybiB7XG4gICAgICBJbXBvcnREZWNsYXJhdGlvbjogZnVuY3Rpb24gaGFuZGxlSW1wb3J0cyhub2RlKSB7XG4gICAgICAgIGlmIChub2RlLnNwZWNpZmllcnMubGVuZ3RoKSB7IC8vIElnbm9yaW5nIHVuYXNzaWduZWQgaW1wb3J0c1xuICAgICAgICAgIGNvbnN0IG5hbWUgPSBub2RlLnNvdXJjZS52YWx1ZVxuICAgICAgICAgIHJlZ2lzdGVyTm9kZShcbiAgICAgICAgICAgIGNvbnRleHQsXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIG5vZGUsXG4gICAgICAgICAgICAgIHZhbHVlOiBuYW1lLFxuICAgICAgICAgICAgICBkaXNwbGF5TmFtZTogbmFtZSxcbiAgICAgICAgICAgICAgdHlwZTogJ2ltcG9ydCcsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcmFua3MsXG4gICAgICAgICAgICBpbXBvcnRlZCxcbiAgICAgICAgICAgIHBhdGhHcm91cHNFeGNsdWRlZEltcG9ydFR5cGVzXG4gICAgICAgICAgKVxuICAgICAgICB9XG4gICAgICB9LFxuICAgICAgVFNJbXBvcnRFcXVhbHNEZWNsYXJhdGlvbjogZnVuY3Rpb24gaGFuZGxlSW1wb3J0cyhub2RlKSB7XG4gICAgICAgIGxldCBkaXNwbGF5TmFtZVxuICAgICAgICBsZXQgdmFsdWVcbiAgICAgICAgbGV0IHR5cGVcbiAgICAgICAgLy8gc2tpcCBcImV4cG9ydCBpbXBvcnRcInNcbiAgICAgICAgaWYgKG5vZGUuaXNFeHBvcnQpIHtcbiAgICAgICAgICByZXR1cm5cbiAgICAgICAgfVxuICAgICAgICBpZiAobm9kZS5tb2R1bGVSZWZlcmVuY2UudHlwZSA9PT0gJ1RTRXh0ZXJuYWxNb2R1bGVSZWZlcmVuY2UnKSB7XG4gICAgICAgICAgdmFsdWUgPSBub2RlLm1vZHVsZVJlZmVyZW5jZS5leHByZXNzaW9uLnZhbHVlXG4gICAgICAgICAgZGlzcGxheU5hbWUgPSB2YWx1ZVxuICAgICAgICAgIHR5cGUgPSAnaW1wb3J0J1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHZhbHVlID0gJydcbiAgICAgICAgICBkaXNwbGF5TmFtZSA9IGNvbnRleHQuZ2V0U291cmNlQ29kZSgpLmdldFRleHQobm9kZS5tb2R1bGVSZWZlcmVuY2UpXG4gICAgICAgICAgdHlwZSA9ICdpbXBvcnQ6b2JqZWN0J1xuICAgICAgICB9XG4gICAgICAgIHJlZ2lzdGVyTm9kZShcbiAgICAgICAgICBjb250ZXh0LFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIG5vZGUsXG4gICAgICAgICAgICB2YWx1ZSxcbiAgICAgICAgICAgIGRpc3BsYXlOYW1lLFxuICAgICAgICAgICAgdHlwZSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIHJhbmtzLFxuICAgICAgICAgIGltcG9ydGVkLFxuICAgICAgICAgIHBhdGhHcm91cHNFeGNsdWRlZEltcG9ydFR5cGVzXG4gICAgICAgIClcbiAgICAgIH0sXG4gICAgICBDYWxsRXhwcmVzc2lvbjogZnVuY3Rpb24gaGFuZGxlUmVxdWlyZXMobm9kZSkge1xuICAgICAgICBpZiAoIWlzU3RhdGljUmVxdWlyZShub2RlKSB8fCAhaXNNb2R1bGVMZXZlbFJlcXVpcmUobm9kZSkpIHtcbiAgICAgICAgICByZXR1cm5cbiAgICAgICAgfVxuICAgICAgICBjb25zdCBuYW1lID0gbm9kZS5hcmd1bWVudHNbMF0udmFsdWVcbiAgICAgICAgcmVnaXN0ZXJOb2RlKFxuICAgICAgICAgIGNvbnRleHQsXG4gICAgICAgICAge1xuICAgICAgICAgICAgbm9kZSxcbiAgICAgICAgICAgIHZhbHVlOiBuYW1lLFxuICAgICAgICAgICAgZGlzcGxheU5hbWU6IG5hbWUsXG4gICAgICAgICAgICB0eXBlOiAncmVxdWlyZScsXG4gICAgICAgICAgfSxcbiAgICAgICAgICByYW5rcyxcbiAgICAgICAgICBpbXBvcnRlZCxcbiAgICAgICAgICBwYXRoR3JvdXBzRXhjbHVkZWRJbXBvcnRUeXBlc1xuICAgICAgICApXG4gICAgICB9LFxuICAgICAgJ1Byb2dyYW06ZXhpdCc6IGZ1bmN0aW9uIHJlcG9ydEFuZFJlc2V0KCkge1xuICAgICAgICBpZiAobmV3bGluZXNCZXR3ZWVuSW1wb3J0cyAhPT0gJ2lnbm9yZScpIHtcbiAgICAgICAgICBtYWtlTmV3bGluZXNCZXR3ZWVuUmVwb3J0KGNvbnRleHQsIGltcG9ydGVkLCBuZXdsaW5lc0JldHdlZW5JbXBvcnRzKVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGFscGhhYmV0aXplLm9yZGVyICE9PSAnaWdub3JlJykge1xuICAgICAgICAgIG11dGF0ZVJhbmtzVG9BbHBoYWJldGl6ZShpbXBvcnRlZCwgYWxwaGFiZXRpemUpXG4gICAgICAgIH1cblxuICAgICAgICBtYWtlT3V0T2ZPcmRlclJlcG9ydChjb250ZXh0LCBpbXBvcnRlZClcblxuICAgICAgICBpbXBvcnRlZCA9IFtdXG4gICAgICB9LFxuICAgIH1cbiAgfSxcbn1cbiJdfQ==