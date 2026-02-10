import { EJSON } from 'bson';
import { getLogger } from 'sengo';

/**
 * Converts MongoDB-style query syntax with unquoted property names to valid JSON.
 * Examples:
 *   {_id: "123"} => {"_id": "123"}
 *   {age: {$gte: 18}} => {"age": {"$gte": 18}}
 *   {name: "John", active: true} => {"name": "John", "active": true}
 */
export function convertToValidJson(input: string): string {
  let result = '';
  let i = 0;
  
  while (i < input.length) {
    const char = input[i];
    
    // Pass through whitespace
    if (/\s/.test(char)) {
      result += char;
      i++;
      continue;
    }
    
    // Pass through structural characters
    if (['[', ']', '{', '}', ':', ','].includes(char)) {
      result += char;
      i++;
      continue;
    }
    
    // Handle quoted strings - pass through as-is
    if (char === '"' || char === "'") {
      const quote = char;
      result += '"'; // Always use double quotes in output
      i++;
      let escaped = false;
      while (i < input.length) {
        const c = input[i];
        if (escaped) {
          result += c;
          escaped = false;
        } else if (c === '\\') {
          result += c;
          escaped = true;
        } else if (c === quote) {
          result += '"';
          i++;
          break;
        } else if (quote === "'" && c === '"') {
          // Escape double quotes when converting from single quotes
          result += '\\"';
        } else {
          result += c;
        }
        i++;
      }
      continue;
    }
    
    // Handle unquoted identifiers (property names, values)
    if (/[a-zA-Z_$]/.test(char)) {
      let identifier = '';
      while (i < input.length && /[a-zA-Z0-9_$]/.test(input[i])) {
        identifier += input[i];
        i++;
      }
      
      // Check what comes after the identifier
      let j = i;
      while (j < input.length && /\s/.test(input[j])) j++;
      
      const nextChar = input[j];
      
      // If followed by ':', it's a property name - quote it
      if (nextChar === ':') {
        result += `"${identifier}"`;
      } else {
        // It's a value - check if it's a boolean/null keyword
        if (identifier === 'true' || identifier === 'false' || identifier === 'null') {
          result += identifier;
        } else {
          // Unknown identifier - quote it as a string
          result += `"${identifier}"`;
        }
      }
      continue;
    }
    
    // Handle numbers
    if (/[0-9\-]/.test(char)) {
      let number = '';
      let isNumber = true;
      let j = i;
      
      // Check for negative sign
      if (char === '-') {
        number += char;
        j++;
      }
      
      // Collect digits, decimal point, exponent
      while (j < input.length && /[0-9.eE+\-]/.test(input[j])) {
        number += input[j];
        j++;
      }
      
      // Verify it's a valid number
      if (number && !isNaN(Number(number))) {
        result += number;
        i = j;
      } else {
        // Not a valid number, treat as string
        result += `"${char}"`;
        i++;
      }
      continue;
    }
    
    // Unknown character - pass through
    result += char;
    i++;
  }
  
  return result;
}

/**
 * Parse arguments from command line, handling both quoted and unquoted JSON.
 * Returns array of parsed arguments (strings, objects, arrays).
 */
export function parseArgsWithJson(input: string[]): any[] {
  const args: any[] = [];
  let buffer = '';
  let inJson = false;
  let braceCount = 0;
  
  for (let i = 0; i < input.length; i++) {
    const token = input[i];
    
    if (!inJson && (token.startsWith('{') || token.startsWith('['))) {
      inJson = true;
      braceCount = 0;
      buffer = '';
    }
    
    if (inJson) {
      buffer += (buffer ? ' ' : '') + token;
      
      // Count braces/brackets
      for (const char of token) {
        if (char === '{' || char === '[') braceCount++;
        if (char === '}' || char === ']') braceCount--;
      }
      
      if (braceCount === 0) {
        // End of JSON object/array
        try {
          // Convert MongoDB-style syntax to valid JSON
          const validJson = convertToValidJson(buffer);
          args.push(EJSON.parse(validJson));
        } catch (err) {
          const msg = 'Error: Parsing error: Only valid JSON or MongoDB Extended JSON is accepted.';
          console.error(msg);
          getLogger().error(err, msg);
          return [];
        }
        inJson = false;
        buffer = '';
      }
    } else {
      args.push(token);
    }
  }
  
  // If buffer is not empty, try to parse last JSON
  if (buffer) {
    try {
      const validJson = convertToValidJson(buffer);
      args.push(EJSON.parse(validJson));
    } catch (err) {
      const msg = 'Error: Parsing error: Only valid JSON or MongoDB Extended JSON is accepted.';
      console.error(msg);
      getLogger().error(err, msg);
      return [];
    }
  }
  
  return args;
}

/**
 * Parse a command line into command name and arguments.
 * Preserves JSON structures and handles quoted strings.
 */
export function parseCommandLine(line: string): { command: string; rest: string[] } {
  // Trim whitespace first
  const trimmedLine = line.trim();
  
  // Extract command (first word) and keep the rest
  const match = trimmedLine.match(/^(\S+)\s*(.*)$/);
  if (!match) {
    return { command: '', rest: [] };
  }
  
  const command = match[1];
  const argsString = match[2].trim();
  
  if (!argsString) {
    return { command, rest: [] };
  }
  
  // Split arguments intelligently, preserving JSON structures
  const args: string[] = [];
  let current = '';
  let inJson = false;
  let braceCount = 0;
  let inString = false;
  let stringChar = '';
  let escapeNext = false;
  
  for (let i = 0; i < argsString.length; i++) {
    const char = argsString[i];
    
    if (escapeNext) {
      current += char;
      escapeNext = false;
      continue;
    }
    
    if (char === '\\') {
      current += char;
      escapeNext = true;
      continue;
    }
    
    if ((char === '"' || char === "'") && !inString) {
      inString = true;
      stringChar = char;
      current += char;
      continue;
    }
    
    if (inString && char === stringChar) {
      inString = false;
      current += char;
      continue;
    }
    
    if (!inString) {
      if (char === '{' || char === '[') {
        if (!inJson) {
          inJson = true;
          braceCount = 0;
        }
        braceCount++;
        current += char;
        continue;
      }
      
      if (char === '}' || char === ']') {
        braceCount--;
        current += char;
        if (braceCount === 0) {
          inJson = false;
        }
        continue;
      }
      
      if (!inJson && /\s/.test(char)) {
        if (current) {
          args.push(current);
          current = '';
        }
        continue;
      }
    }
    
    current += char;
  }
  
  if (current) {
    args.push(current);
  }
  
  return { command, rest: args };
}
