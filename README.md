# VHDL Testbench Generation

## Usage via git

```sh
git clone https://github.com/esdmr/vhdl-tb-gen.git
node vhdl-tb-gen/index.js <input_file>.vhdl [<output_file>.vhdl]
```

## Usage via npm

```sh
npm i -g @esdmr/vhdl-tb-gen
vhdl-tb-gen <input_file>.vhdl [<output_file>.vhdl]
```

## Syntax

These must go in line comments. The syntax looks like VHDL, but it is sensitive to line break. (Each command MUST be in a separate line comment.)

- `testbench <name> of <entity name> is`: Start a testbench definition. Use name of `tb` if there is only one testbench for the entity.
- `sync every <duration>;`: Duration to wait between input.
- `sync (<clock>) every <duration>;`: Like above. Also initializes a clock signal at half that frequency.
- `begin`: Start testbench body.
- `every (<signal>[, ...]);`: Try every possible value of the given signals, in order. Wait for the sync duration for each of them.
- `set (<signal> <= <value>[; ...]);`: Set some signals and wait for the sync duration.
- `end;`: Finish the testbench body and definition.

## Example

```vhdl
library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;
use ieee.math_real.all;

entity ha is
	port (
		a, b  : in  std_logic;
		s, co : out std_logic);
end;

architecture arch of ha is
begin
	s  <= a xor b;
	co <= a and b;
end architecture;

-- testbench tb of ha is
-- begin
-- every (a, b);
-- end;
```

## License

MIT © 2025 esdmr
