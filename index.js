#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const Parser = require('tree-sitter');
const Vhdl = require('tree-sitter-vhdl');
const assert = require('assert');

// #region Type Bounds
/**
 * @param {string} type
 * @param {Parser.SyntaxNode} [range]
 * @returns {{low: string, high: string, converter(i: string): string}}
 */
function getTypeBounds(type, range) {
	const name = type.match(/^\w+/)?.[0];

	switch (name) {
		case 'bit':
		case 'std_logic':
		case 'std_ulogic': {
			return {
				low: "0",
				high: "1",
				converter: (i) => `${type}'val(${i})`,
			};
		}

		case 'std_ulogic_vector':
		case 'std_logic_vector': {
			if (!range) {
				console.warn(`Incomplete type ${type} without a range. ignoring it.`);
				break;
			}

			const [left, kind, right] = range.children;
			const reversed = kind.text === 'to';
			const length = `((${reversed ? right.text : left.text}) - (${reversed ? left.text : right.text}) + 1)`;

			return {
				low: "0",
				high: `2 ** ${length} - 1`,
				converter: (i) => `${name}(to_unsigned(${i}, ${length}))`,
			};
		}

		default: {
			console.warn(`Unknown type ${type}. ignoring it.`);
		}
	}

	return {
		low: '',
		high: '',
		converter: () => '',
	};
}
// #endregion

// #region Read input
assert.ok(process.argv.length >= 3, 'Usage: node index.js <input_file>.vhdl [<output_file>.vhdl]');
const inputPath = process.argv[2];

console.log('Reading from', inputPath);
const input = fs.readFileSync(inputPath, 'utf8');
// #endregion

// #region Parsing input
const parser = new Parser();
parser.setLanguage(/** @type {any} */(Vhdl));
const ast = parser.parse(input);
// #endregion

// #region First pass
/** @type {Record<string, string>} */
const entityClauses = {};
/** @type {Record<string, Record<string, {mode: string, type: string} & ReturnType<typeof getTypeBounds>>>} */
const entityPins = {};
/** @type {Record<string, string>} */
const entityHeads = {};

for (const node of ast.rootNode.descendantsOfType('entity_declaration')) {
	const name = node.childForFieldName('entity')?.text;
	assert.ok(name);

	// #region Entity clauses
	entityClauses[name] = '';

	for (const subnode of node.parent?.descendantsOfType(['library_clause', 'use_clause']) ?? []) {
		entityClauses[name] += subnode.text + '\n';
	}
	// #endregion

	// #region Entity head
	const head = node.descendantsOfType('entity_head')?.[0];
	entityHeads[name] = head.text;
	// #endregion

	// #region Entity ports
	const port = head?.children.filter(i => i.type === 'port_clause')[0];
	const interfaces = port?.descendantsOfType('interface_declaration') || [];
	entityPins[name] ||= {};

	for (const int of interfaces) {
		const ports = int.children[0].descendantsOfType('identifier').map(i => i.text);
		const [mode, type] = int.children[2].children;
		assert.equal(int.children[2].type, 'simple_mode_indication', `port mode ${mode.type} not supported: entity ${name} port(s) ${ports}: ${mode.text}`);
		const bounds = getTypeBounds(type.text, type.descendantsOfType('simple_range')?.[0]);

		for (const port of ports) {
			entityPins[name][port.trim()] = {mode: mode.text, type: type.text, ...bounds};
		}
	}
	// #endregion
}
// #endregion

// #region Second pass
const defaultState = {
	entity: '',
	testbench: '',
	sync: '1 ns',
	clock: '',
};

let output = '';
/** @type {typeof defaultState | undefined} */
let state;

for (const node of ast.rootNode.descendantsOfType('line_comment')) {
	const text = node.firstChild?.text.trim();
	assert.ok(text !== undefined);
	if (!state && !text.startsWith('testbench ')) continue;

	switch (text.match(/^\S+/)?.[0]) {
		case 'testbench': {
			// #region - -- testbench
			const [_tb, name, _of, entity] = text.split(' ').filter(Boolean);
			state = {
				...defaultState,
				entity,
				testbench: name === 'tb' ? `${entity}_tb` : `${entity}_tb_${name}`,
			};
			output += `${entityClauses[state.entity]}\nentity ${state.testbench} is end;\n\n`;
			break;
			// #endregion
		}

		case 'sync': {
			// #region - -- sync
			assert.ok(state);
			state.sync = text.match(/\bevery (.+);$/i)?.[1] || '1 ns';
			state.clock = text.match(/^sync \(([^)]+)\)/)?.[1] || '';
			break;
			// #endregion
		}

		case 'begin': {
			// #region - -- begin
			assert.ok(state);
			output += `architecture tb of ${state.testbench} is\n`;
			output += `component ${state.entity} ${entityHeads[state.entity]}\n`;
			output += `end component;\n\n`;

			for (const [pin, {type}] of Object.entries(entityPins[state.entity])) {
				output += `signal ${pin} : ${type}${pin === state.clock ? ' := \'0\'' : ''};\n`;
			}

			output += `signal tb_done : bit := '0';\n`;
			output += `begin\n`;
			output += `dut : ${state.entity} port map(`;

			for (const [i, pin] of Object.keys(entityPins[state.entity]).entries()) {
				output += i === 0 ? '' : ', ';
				output += `${pin} => ${pin}`;
			}

			output += `);\n\n`;

			if (state.clock) {
				output += `${state.clock} <= not ${state.clock} after 0.5 * ${state.sync} when tb_done = '0' else '0';\n\n`;
			}

			output += `process\nbegin\n`;
			break;
			// #endregion
		}

		case 'every': {
			// #region - -- every
			assert.ok(state);
			const pins = entityPins[state.entity];
			const names = (text.match(/^every \(([^)]+)\);$/)?.[1] || Object.keys(pins).join(',')).split(',').filter(Boolean).map(i => i.trim()).map(name => ({name, ...pins[name]}));
			output += names.map((n, i) => `for i_${i} in ${n.low} to ${n.high} loop\n${n.name} <= ${n.converter(`i_${i}`)};\n`).join('');
			output += `wait for ${state.sync};\n`;
			output += names.map(() => `end loop;\n`).join('') + '\n';
			break;
			// #endregion
		}

		case 'set': {
			// #region - -- set
			assert.ok(state);
			const defs = text.match(/^set \((.+)\);$/)?.[1] || '';
			output += defs.split(';').filter(Boolean).map(i => i.trim() + ';\n').join('');
			output += `wait for ${state.sync};\n\n`;
			break;
			// #endregion
		}

		case 'end':
		case 'end;': {
			// #region - -- end
			assert.ok(state);
			output += `tb_done <= '1';\n`;
			output += `wait;\n`;
			output += `end process;\n`;
			output += `end;\n\n`;
			console.log(`Generated testbench ${state.testbench} for ${state.entity}.`);
			state = undefined;
			break;
			// #endregion
		}

		default: {
			console.warn(`Ignoring line comment: -- ${text}`);
		}
	}
}
// #endregion

// #region Write output
const outputPath = process.argv[3] || path.join(
	path.dirname(inputPath),
	path.basename(inputPath, '.vhdl')
		.replaceAll('.', '_') +
	'_tb.vhdl'
);

console.log('Writing to', outputPath);
fs.writeFileSync(outputPath, output.replace(/\n{3,}/g, '\n\n').trim() + '\n', 'utf8');
// #endregion
