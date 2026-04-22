import Parser = require('tree-sitter');

export type TreeSitterGhostAccessMode = 'read' | 'write' | 'readwrite';
export type TreeSitterGhostReferenceKind = 'self' | 'external';

export interface TreeSitterGhostReference {
    kind: TreeSitterGhostReferenceKind;
    label: string;
    rootName: string;
    propertyName?: string;
    mode: TreeSitterGhostAccessMode;
}

export interface TreeSitterGhostScanOptions {
    parameterNodes?: string[];
    localDeclarationNodes?: string[];
    identifierNodes?: string[];
    memberExpressionNodes?: string[];
    functionBodyNodes?: string[];
    selfNames?: string[];
    ignoreNames?: string[];
}

const DEFAULT_OPTIONS: Required<TreeSitterGhostScanOptions> = {
    parameterNodes: [
        'formal_parameters',
        'parameters',
        'parameter_list',
        'required_parameter',
        'optional_parameter',
        'parameter_declaration',
        'typed_parameter',
        'default_parameter',
        'rest_pattern'
    ],
    localDeclarationNodes: [
        'variable_declarator',
        'variable_declaration',
        'lexical_declaration',
        'assignment_pattern',
        'for_in_clause',
        'for_statement',
        'short_var_declaration',
        'let_declaration'
    ],
    identifierNodes: [
        'identifier',
        'property_identifier',
        'field_identifier',
        'type_identifier',
        'namespace_identifier',
        'shorthand_property_identifier',
        'shorthand_property_identifier_pattern'
    ],
    memberExpressionNodes: [
        'member_expression',
        'field_expression',
        'attribute',
        'selector_expression',
        'scoped_identifier',
        'qualified_identifier'
    ],
    functionBodyNodes: ['statement_block', 'block', 'body', 'compound_statement'],
    selfNames: ['this', 'self'],
    ignoreNames: [
        'Array',
        'Boolean',
        'Date',
        'Error',
        'Intl',
        'JSON',
        'Map',
        'Math',
        'Number',
        'Object',
        'Promise',
        'Reflect',
        'RegExp',
        'Set',
        'String',
        'Symbol',
        'WeakMap',
        'WeakSet',
        'console',
        'document',
        'globalThis',
        'process',
        'window'
    ]
};

export function scanTreeSitterGhostReferences(
    executableNode: Parser.SyntaxNode,
    options: TreeSitterGhostScanOptions = {}
) {
    const profile = mergeOptions(options);
    const parameters = new Set(extractParameterNames(executableNode, profile));
    const locals = new Set(parameters);
    const bodyNode = findFunctionBody(executableNode, profile) ?? executableNode;
    const references = new Map<string, TreeSitterGhostReference>();

    collectLocalNames(bodyNode, locals, profile);

    for (const node of walkNodes(bodyNode)) {
        if (isMemberExpression(node, profile)) {
            if (!isOutermostMemberExpression(node, profile)) {
                continue;
            }

            const memberReference = extractMemberGhostReference(node, parameters, locals, profile);
            if (memberReference) {
                mergeReference(references, memberReference);
            }
            continue;
        }

        if (!isIdentifierNode(node, profile)) {
            continue;
        }

        const name = normalizeName(node.text);
        if (!name || parameters.has(name) || locals.has(name) || profile.ignoreNames.includes(name)) {
            continue;
        }

        if (isDeclarationName(node, profile) || isMemberPropertyName(node, profile)) {
            continue;
        }

        if (isMemberRootIdentifier(node, profile)) {
            continue;
        }

        mergeReference(references, {
            kind: profile.selfNames.includes(name) ? 'self' : 'external',
            label: name,
            rootName: name,
            mode: getGhostAccessMode(node, profile)
        });
    }

    return Array.from(references.values()).sort((left, right) => left.label.localeCompare(right.label));
}

function mergeOptions(options: TreeSitterGhostScanOptions) {
    return {
        parameterNodes: options.parameterNodes ?? DEFAULT_OPTIONS.parameterNodes,
        localDeclarationNodes: options.localDeclarationNodes ?? DEFAULT_OPTIONS.localDeclarationNodes,
        identifierNodes: options.identifierNodes ?? DEFAULT_OPTIONS.identifierNodes,
        memberExpressionNodes: options.memberExpressionNodes ?? DEFAULT_OPTIONS.memberExpressionNodes,
        functionBodyNodes: options.functionBodyNodes ?? DEFAULT_OPTIONS.functionBodyNodes,
        selfNames: options.selfNames ?? DEFAULT_OPTIONS.selfNames,
        ignoreNames: options.ignoreNames ?? DEFAULT_OPTIONS.ignoreNames
    };
}

function collectLocalNames(
    rootNode: Parser.SyntaxNode,
    locals: Set<string>,
    profile: Required<TreeSitterGhostScanOptions>
) {
    for (const node of walkNodes(rootNode)) {
        if (node.type === 'function_declaration' || node.type === 'class_declaration' || node.type === 'enum_declaration') {
            const nameNode = node.childForFieldName('name') ?? node.namedChildren[0] ?? null;
            const name = normalizeName(nameNode?.text ?? '');
            if (name) {
                locals.add(name);
            }
            continue;
        }

        if (!profile.localDeclarationNodes.includes(node.type)) {
            continue;
        }

        const nameNode = node.childForFieldName('name') ?? node.namedChildren[0] ?? null;
        for (const name of extractBindingNames(nameNode, profile)) {
            locals.add(name);
        }
    }
}

function extractParameterNames(
    executableNode: Parser.SyntaxNode,
    profile: Required<TreeSitterGhostScanOptions>
) {
    const parametersNode =
        executableNode.childForFieldName('parameters') ??
        executableNode.namedChildren.find((node) => profile.parameterNodes.includes(node.type)) ??
        null;

    if (!parametersNode) {
        return [];
    }

    return parametersNode.namedChildren.flatMap((child) =>
        extractBindingNames(child.childForFieldName('pattern') ?? child.childForFieldName('name') ?? child.namedChildren[0] ?? child, profile)
    );
}

function extractBindingNames(
    node: Parser.SyntaxNode | null,
    profile: Required<TreeSitterGhostScanOptions>
): string[] {
    if (!node || isTypeOnlyNode(node)) {
        return [];
    }

    if (isMemberExpression(node, profile) || node.type === 'subscript') {
        return [];
    }

    if (isIdentifierNode(node, profile) && !isMemberPropertyName(node, profile)) {
        const name = normalizeName(node.text);
        return name ? [name] : [];
    }

    const names: string[] = [];
    for (const child of node.namedChildren) {
        names.push(...extractBindingNames(child, profile));
    }
    return Array.from(new Set(names));
}

function findFunctionBody(
    executableNode: Parser.SyntaxNode,
    profile: Required<TreeSitterGhostScanOptions>
) {
    const body = executableNode.childForFieldName('body');
    if (body) {
        return body;
    }

    return executableNode.namedChildren.find((node) => profile.functionBodyNodes.includes(node.type)) ?? null;
}

function extractMemberGhostReference(
    node: Parser.SyntaxNode,
    parameters: Set<string>,
    locals: Set<string>,
    profile: Required<TreeSitterGhostScanOptions>
): TreeSitterGhostReference | null {
    const memberRoot = getMemberRoot(node, profile);
    if (!memberRoot || !memberRoot.rootName || profile.ignoreNames.includes(memberRoot.rootName)) {
        return null;
    }

    if (profile.selfNames.includes(memberRoot.rootName)) {
        const propertyName = memberRoot.propertyName;
        const label = propertyName ? `${memberRoot.rootName}.${propertyName}` : memberRoot.rootName;
        return {
            kind: 'self',
            label,
            rootName: propertyName ?? memberRoot.rootName,
            propertyName,
            mode: getGhostAccessMode(node, profile)
        };
    }

    if (parameters.has(memberRoot.rootName) || locals.has(memberRoot.rootName)) {
        return null;
    }

    return {
        kind: 'external',
        label: memberRoot.rootName,
        rootName: memberRoot.rootName,
        mode: getGhostAccessMode(node, profile)
    };
}

function getMemberRoot(
    node: Parser.SyntaxNode,
    profile: Required<TreeSitterGhostScanOptions>
) {
    let current: Parser.SyntaxNode | null = node;

    while (current && isMemberExpression(current, profile)) {
        const objectNode: Parser.SyntaxNode | null = current.namedChildren[0] ?? null;
        if (!objectNode) {
            return null;
        }

        if (profile.selfNames.includes(objectNode.type) || profile.selfNames.includes(objectNode.text)) {
            const propertyName = getNodeName(current.namedChildren[1] ?? current.childForFieldName('property') ?? null);
            return {
                rootName: objectNode.text,
                propertyName
            };
        }

        if (isIdentifierNode(objectNode, profile)) {
            return {
                rootName: normalizeName(objectNode.text),
                propertyName: getNodeName(current.namedChildren[1] ?? current.childForFieldName('property') ?? null)
            };
        }

        current = objectNode;
    }

    return null;
}

function getGhostAccessMode(
    node: Parser.SyntaxNode,
    profile: Required<TreeSitterGhostScanOptions>
): TreeSitterGhostAccessMode {
    const target = getAccessTarget(node, profile);
    const parent = target.parent;
    if (!parent) {
        return 'read';
    }

    if (isAssignmentNode(parent) && parent.namedChildren[0]?.id === target.id) {
        return parent.type === 'augmented_assignment_expression' || parent.type === 'augmented_assignment'
            ? 'readwrite'
            : 'write';
    }

    if (parent.type === 'update_expression' && parent.namedChildren.some((child) => child.id === target.id)) {
        return 'readwrite';
    }

    return 'read';
}

function getAccessTarget(
    node: Parser.SyntaxNode,
    profile: Required<TreeSitterGhostScanOptions>
) {
    let current = node;

    while (current.parent) {
        const parent = current.parent;
        if (isMemberExpression(parent, profile) && parent.namedChildren[0]?.id === current.id) {
            current = parent;
            continue;
        }

        if (isExpressionWrapper(parent)) {
            current = parent;
            continue;
        }

        return current;
    }

    return current;
}

function mergeReference(
    references: Map<string, TreeSitterGhostReference>,
    reference: TreeSitterGhostReference
) {
    const current = references.get(reference.label);
    if (!current) {
        references.set(reference.label, reference);
        return;
    }

    references.set(reference.label, {
        ...current,
        mode: mergeAccessMode(current.mode, reference.mode)
    });
}

function mergeAccessMode(
    left: TreeSitterGhostAccessMode,
    right: TreeSitterGhostAccessMode
): TreeSitterGhostAccessMode {
    if (left === right) {
        return left;
    }
    if (left === 'readwrite' || right === 'readwrite') {
        return 'readwrite';
    }
    return 'readwrite';
}

function isAssignmentNode(node: Parser.SyntaxNode) {
    return (
        node.type === 'assignment_expression' ||
        node.type === 'augmented_assignment_expression' ||
        node.type === 'augmented_assignment' ||
        node.type === 'assignment_statement' ||
        node.type === 'short_var_declaration'
    );
}

function isExpressionWrapper(node: Parser.SyntaxNode) {
    return (
        node.type === 'parenthesized_expression' ||
        node.type === 'as_expression' ||
        node.type === 'satisfies_expression' ||
        node.type === 'non_null_expression' ||
        node.type === 'type_assertion'
    );
}

function isOutermostMemberExpression(
    node: Parser.SyntaxNode,
    profile: Required<TreeSitterGhostScanOptions>
) {
    return !(node.parent && isMemberExpression(node.parent, profile) && node.parent.namedChildren[0]?.id === node.id);
}

function isMemberRootIdentifier(
    node: Parser.SyntaxNode,
    profile: Required<TreeSitterGhostScanOptions>
) {
    return !!node.parent && isMemberExpression(node.parent, profile) && node.parent.namedChildren[0]?.id === node.id;
}

function isDeclarationName(
    node: Parser.SyntaxNode,
    profile: Required<TreeSitterGhostScanOptions>
) {
    const parent = node.parent;
    if (!parent || !isIdentifierNode(node, profile)) {
        return false;
    }

    return (
        ((parent.type === 'variable_declarator' || parent.type === 'pair_pattern') && parent.namedChildren[0]?.id === node.id) ||
        (profile.parameterNodes.includes(parent.type) && parent.namedChildren[0]?.id === node.id) ||
        ((parent.type === 'function_declaration' ||
            parent.type === 'method_definition' ||
            parent.type === 'class_declaration' ||
            parent.type === 'public_field_definition' ||
            parent.type === 'field_definition' ||
            parent.type === 'enum_declaration') &&
            parent.namedChildren[0]?.id === node.id) ||
        ((parent.type === 'import_specifier' || parent.type === 'namespace_import' || parent.type === 'import_clause') &&
            parent.namedChildren.some((child) => child.id === node.id))
    );
}

function isMemberPropertyName(
    node: Parser.SyntaxNode,
    profile: Required<TreeSitterGhostScanOptions>
) {
    const parent = node.parent;
    return !!parent && isMemberExpression(parent, profile) && parent.namedChildren[1]?.id === node.id;
}

function isTypeOnlyNode(node: Parser.SyntaxNode) {
    return (
        node.type === 'type_annotation' ||
        node.type === 'predefined_type' ||
        node.type === 'type_identifier' ||
        node.type === 'generic_type' ||
        node.type === 'type_arguments'
    );
}

function isIdentifierNode(
    node: Parser.SyntaxNode,
    profile: Required<TreeSitterGhostScanOptions>
) {
    return profile.identifierNodes.includes(node.type);
}

function isMemberExpression(
    node: Parser.SyntaxNode,
    profile: Required<TreeSitterGhostScanOptions>
) {
    return profile.memberExpressionNodes.includes(node.type);
}

function getNodeName(node: Parser.SyntaxNode | null): string {
    if (!node) {
        return '';
    }

    if (
        node.type === 'identifier' ||
        node.type === 'property_identifier' ||
        node.type === 'field_identifier' ||
        node.type === 'type_identifier' ||
        node.type === 'namespace_identifier'
    ) {
        return normalizeName(node.text);
    }

    return node.namedChildren.length > 0 ? getNodeName(node.namedChildren[node.namedChildren.length - 1]) : normalizeName(node.text);
}

function normalizeName(text: string) {
    const name = text.trim();
    if (!name || /^['"`]/.test(name) || /^\d/.test(name)) {
        return '';
    }
    return name;
}

function walkNodes(root: Parser.SyntaxNode) {
    const nodes: Parser.SyntaxNode[] = [];
    const cursor = root.walk();
    let reachedRoot = false;

    while (true) {
        if (!reachedRoot) {
            nodes.push(cursor.currentNode);
            reachedRoot = true;
        }

        if (cursor.gotoFirstChild()) {
            nodes.push(cursor.currentNode);
            continue;
        }

        if (cursor.gotoNextSibling()) {
            nodes.push(cursor.currentNode);
            continue;
        }

        let advanced = false;
        while (cursor.gotoParent()) {
            if (cursor.gotoNextSibling()) {
                nodes.push(cursor.currentNode);
                advanced = true;
                break;
            }
        }

        if (!advanced) {
            break;
        }
    }

    return nodes;
}
