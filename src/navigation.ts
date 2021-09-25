// Navigation classes
'use strict';

import { MarkdownString, ParameterInformation, Position, Range, SignatureInformation, TextDocument } from "vscode";
import { NavigationData } from "./navigationdata";

export class Navigation {
	source: string;
	keyword: string;
	filename: string;
	location: number;
	character: number;
	args: string;
	type: string;
	documentation: string;

	constructor(source: string, keyword: string, filename: string, location: number, documentation: string = "", args: string = "", type: string = "", character: number = 0) {
		this.source = source;
		this.keyword = keyword;
		this.filename = filename;
		this.location = location;
		this.character = character;
		this.documentation = documentation;
		this.args = args;
		this.type = type;
		if (this.documentation) {
			this.documentation = this.documentation.replace(/\\\\/g, '\"');
		}
	}

	toRange() : Range {
		return new Range(this.location - 1, this.character, this.location - 1, this.character + this.keyword.length);
	}
}

export class DataType {
	variable: string;
	define: string;
	baseclass: string;
	type: string;

	constructor(variable:string, define:string, baseclass:string) {
		this.variable = variable;
		this.define = define;
		this.baseclass = baseclass;
		this.type = "";
		if (baseclass === 'True' || baseclass === 'False') {
			this.type = 'boolean';
		} else if (!isNaN(+this.baseclass)) {
			this.type = 'number';
		} else if (baseclass === '_' || baseclass.startsWith('"') || baseclass.startsWith('`') || baseclass.startsWith("'")) {
			this.type = 'string';
		} else if (baseclass === '[') {
			this.type = 'set';
		} else if (baseclass === '{') {
			this.type = 'dictionary';
		}
	}
	
	checkTypeArray(type: string, typeArray: string[]) {
		if (typeArray.includes(this.baseclass)) {
			this.type = type;
		}
	}
}

export function getPyDocsAtLine(lines: string[], line: number): string {
	let lb: string[] = [];
	let index: number = line;
	
	const margin = lines[index].length - lines[index].trimLeft().length;
	let text = lines[index].replace('"""', '').trim();
	if (text.indexOf('"""')) {
		text = text.replace('"""', '').trim();
		if (text.length > 0) {
			return text;
		}
	}

	index++;
	while (lines[index].indexOf('"""') < 0 && index < lines.length) {
		let line = lines[index].trim();
		if (line.length === 0 || lines[index].length - lines[index].trimLeft().length >= margin + 3) {
			line = '\n\n' + line;
		}

		lb.push(line);
		index++;
	}

	return lb.join(" ").trim();
}

export function getPyDocsFromTextDocumentAtLine(document: TextDocument, line: number): string {
	let lb: string[] = [];
	let index: number = line;

	let text = document.lineAt(index).text;
	if (text.indexOf('"""') < 0) {
		return '';
	}

	text = text.replace('"""', '').trim();
	if (text.indexOf('"""') > 0) {
		// this is a single line comment
		text = text.replace('"""', '').trim();
		if (text.length > 0) {
			return text;
		}
	}

	index++;
	while (document.lineAt(index).text.indexOf('"""') < 0 && index < document.lineCount - 1) {
		lb.push(document.lineAt(index).text.trim());
		index++;
	}

	return lb.join(" ").trim();
}

export function getBaseTypeFromDefine(keyword: string, line: string): string | undefined {
	const rx = /^(default|define)\s+(\w*)\s*=\s*(\w*)\(/;
	line = line.trim();
	const matches = line.match(rx);
	if (matches && matches.length >= 4) {
		const cls = matches[3];
		return cls;
	}
	return;
}

export function getArgumentParameterInfo(location: Navigation, line: string, position: number) : SignatureInformation {
	let documentation = new MarkdownString();
	documentation.appendMarkdown(formatDocumentationAsMarkdown(location.documentation));
	let signature = new SignatureInformation(`${location.keyword}${location.args}`, documentation);

	let parsed='';
	let insideQuote = false;
	let insideParens = false;
	let insideBrackets = false;
	let insideBraces = false;
	let isFirstParen = true;

	// preprocess fragment
	for (let c of line) {
		if (c === '"') {
			c = "'";
			if (!insideQuote) {
				insideQuote = true;
			} else {
				insideQuote = false;
			}
		} else if (c === ' ') {
			c = "_";
		} else if (c === '(') {
			if (!isFirstParen) {
				insideParens = true;
			}
			isFirstParen = false;
		} else if (c === '[') {
			insideBrackets = true;
		} else if (c === '{') {
			insideBraces = true;
		} else if (c === ')') {
			insideParens = false;
		} else if (c === ']') {
			insideBrackets = false;
		} else if (c === '}') {
			insideBraces = false; 
		} else if (c === ',' && (insideQuote || insideParens || insideBrackets || insideBraces)) {
			c = ';';
		}
		parsed += c;
	}

	// split the user's args
	const firstParenIndex = parsed.indexOf('(');
	let parameterStart = firstParenIndex + 1;
	const parsedIndex = parsed.substr(parameterStart);
	const split = parsedIndex.split(',');

	const fragment = parsed.substring(0, position);
	const fragmentSplit = parsed.substr(fragment.indexOf('(') + 1).split(',');

	// calculate the current parameter
	let currentArgument: number = fragmentSplit.length - 1;
	let kwarg = "";
	if (split[currentArgument].indexOf('=') > 0) {
		const kwargSplit = split[currentArgument].split('=');
		kwarg = kwargSplit[0].trim().replace('_','');
	}

	// process the method's args
	let parameters: ParameterInformation[] = [];
	let args = location.args;
	if (args) {
		if (args.startsWith('(')) {
			args = args.substr(1);
		}
		if (args.endsWith(')')) {
			args = args.substr(0, args.length - 1);
		}

		const argsList = args.split(',');
		if (argsList) {
			let index = 0;

			if (kwarg && kwarg.length > 0) {
				if (argsList[argsList.length - 1].trim() === "**kwargs") {
					currentArgument = argsList.length - 1;
				}
			}

			for (let arg of argsList) {
				const split = arg.trim().split('=');
				let argDocs = "`" + split[0].trim() + "` parameter";
				if (split.length > 1) {
					argDocs = argDocs + ' (optional). Default is `' + split[1].trim() + "`.";
				} else {
					argDocs = argDocs + '.';
				}

				const prm = new ParameterInformation(arg.trim(), new MarkdownString(argDocs));
				parameters.push(prm);

				if (arg.trim().indexOf('=') > 0) {
					const kwargSplit = arg.trim().split('=');
					if (kwargSplit[0] === kwarg) {
						currentArgument = index;
					}
				} else if (arg.trim() === kwarg) {
					currentArgument = index;
				}

				index++;
			}
		}
	}

	signature.activeParameter = currentArgument;
	signature.parameters = parameters;

	return signature;
}

export function formatDocumentationAsMarkdown(documentation: string): string {
	documentation = documentation.replace(/\\/g, '"');
	documentation = documentation.replace("```", '\n\n```');
	documentation = documentation.replace(/:other:/g, '').replace(/:func:/g, '').replace(/:var:/g, '').replace(/:ref:/g, '').replace(/:class:/g,'').replace(/:tpref:/g,'').replace(/:propref:/g,'');
	return documentation.trim();
}

export function splitParameters(line: string, trim=false): string[] {
	let args: string[] = [];

	let parsed='';
	let insideQuote = false;
	let insideParens = false;
	let insideBrackets = false;
	let insideBraces = false;

	for (let c of line) {
		if (c === '"') {
			if (!insideQuote) {
				insideQuote = true;
			} else {
				insideQuote = false;
			}
		} else if (c === '(') {
			insideParens = true;
		} else if (c === '[') {
			insideBrackets = true;
		} else if (c === '{') {
			insideBraces = true;
		} else if (c === ')') {
			insideParens = false;
		} else if (c === ']') {
			insideBrackets = false;
		} else if (c === '}') {
			insideBraces = false;
		} else if (c === ',' && (insideQuote || insideParens || insideBrackets || insideBraces)) {
			c = '\uFE50';
		}
		parsed += c;
	}

	const split = parsed.split(',');
	for (let s of split) {
		if (trim) {
			s = s.trim();
		}
		s = s.replace('\uFE50', ',');
		if (trim) {
			while (s.indexOf(' =') > 0) {
				s = s.replace(' =', '=');
			}
			while (s.indexOf('= ') > 0) {
				s = s.replace('= ', '=');
			}
		}
		args.push(s);
	}

	return args;
}

export function getNamedParameter(strings: string[], named: string): string {
	const search = `${named}=`;
	let value = '';
	const filtered = strings.filter(function (str) { return str.indexOf(search) === 0; });
	if (filtered && filtered.length > 0) {
		var split = filtered[0].split('=');
		value = stripQuotes(split[1]);
	}
	return value;
}

export function stripQuotes(value: string): string {
	if (value.startsWith('"') && value.endsWith('"')) {
		value = value.substr(1);
		value = value.substr(0, value.length - 1);
	} else if (value.startsWith("'") && value.endsWith("'")) {
		value = value.substr(1);
		value = value.substr(0, value.length - 1);
	} else if (value.startsWith("`") && value.endsWith("`")) {
		value = value.substr(1);
		value = value.substr(0, value.length - 1);
	}
	return value;
}

export function rangeAsString(filename: string, range: Range): string {
	return `${filename}:${range.start.line};${range.start.character}-${range.end.character}`;
}

export function getCurrentContext(document: TextDocument, position: Position): string | undefined {
	const rxParentTypes = /\s*(screen|label|transform|def|class|style)\s+([a-zA-Z0-9_]+)\s*(\((.*)\):|:)/;

	let i = position.line;
	while (i >= 0) {
		let line = NavigationData.filterStringLiterals(document.lineAt(i).text);
		//let indent_level = line.length - line.trimLeft().length;
		let match = line.match(rxParentTypes);
		if (match) {
			return match[1];
		}
		i--;
	}

	return;
}