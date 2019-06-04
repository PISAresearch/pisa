# TypeScript StyleGuide and Coding Conventions

This document describes the coding conventions that we adopt in this repository for TypeScript code.

The initial version of this document is freely adapted from https://github.com/basarat/typescript-book/blob/master/docs/styleguide/styleguide.md

## Variable and Function
* Use `camelCase` for variable and function names

> Reason: Conventional JavaScript

**Bad**
```ts
var FooVar;
function BarFunc() { }
```
**Good**
```ts
var fooVar;
function barFunc() { }
```

## Class
* Use `PascalCase` for class names.

> Reason: This is actually fairly conventional in standard JavaScript.

**Bad**
```ts
class foo { }
```
**Good**
```ts
class Foo { }
```
* Use `camelCase` of class members and methods

> Reason: Naturally follows from variable and function naming convention.

**Bad**
```ts
class Foo {
    Bar: number;
    Baz() { }
}
```
**Good**
```ts
class Foo {
    bar: number;
    baz() { }
}
```
## Interface

* Use `PascalCase` for name.

> Reason: Similar to class

* Use `camelCase` for members.

> Reason: Similar to class

* **Don't** prefix with `I`

> Reason: Unconventional. `lib.d.ts` defines important interfaces without an `I` (e.g. Window, Document etc).

**Bad**
```ts
interface IFoo {
}
```
**Good**
```ts
interface Foo {
}
```

## Type

* Use `PascalCase` for name.

> Reason: Similar to class

* Use `camelCase` for members.

> Reason: Similar to class


## Namespace

* Use `PascalCase` for names

> Reason: Convention followed by the TypeScript team. Namespaces are effectively just a class with static members. Class names are `PascalCase` => Namespace names are `PascalCase`

**Bad**
```ts
namespace foo {
}
```
**Good**
```ts
namespace Foo {
}
```

## Enum

* Use `PascalCase` for enum names

> Reason: Similar to Class. Is a Type.

**Bad**
```ts
enum color {
}
```
**Good**
```ts
enum Color {
}
```

* Use `PascalCase` for enum member

> Reason: Convention followed by TypeScript team i.e. the language creators e.g `SyntaxKind.StringLiteral`. Also helps with translation (code generation) of other languages into TypeScript.

**Bad**
```ts
enum Color {
    red
}
```
**Good**

```ts
enum Color {
    Red
}
```

## Null vs. Undefined

### Object members

* Prefer not to use either for explicit unavailability in object members

> Reason: these values are commonly used to keep a consistent structure between values. In TypeScript you use *types* to denote the structure

**Bad**
```ts
let foo = {x:123,y:undefined};
```
**Good**
```ts
let foo:{x:number,y?:number} = {x:123};
```

### Return values, arguments, properties and variables

* Use `null` rather than `undefined` in general to signal unavailability.

***Bad***

```ts
return undefined;
```
***Good***

```ts
return null;
```

* Use `undefined` where its a part of the API or conventional

**Bad**

```ts
cb(undefined)
```
**Good**

```ts
cb(null)
```

* Use *truthy* check for **objects** being `null` or `undefined`

**Bad**

```ts
if (error === null)
```
**Good**
```ts
if (error)
```

* Use `== undefined` / `!= undefined` (not `===` / `!==`) to check for `null` / `undefined` on primitives as it works for both `null`/`undefined` but not other falsy values (like `''`,`0`,`false`) e.g.

**Bad**
```ts
if (error !== null)
```
**Good**
```ts
if (error != undefined)
```

## Formatting
Preferably, use Visual Studio Code and install the "Prettier - Code formatter" extension. Also, enable the option `"editor.formatOnSave": "true"`in your settings. The .prettierrc.js file in the repo already contains the appropriate settings for Prettier.

### Quotes

* Prefer double quotes (`"`) for strings; this is already enforced by our Prettier settings.

### Spaces

* Use `4` spaces. Not tabs.

## Semicolons

* Always use semicolons.

> Reasons: Explicit semicolons helps language formatting tools give consistent results. Missing ASI (automatic semicolon insertion) can trip new devs e.g. `foo() \n (function(){})` will be a single statement (not two). TC39 [warning on this as well](https://github.com/tc39/ecma262/pull/1062). Example teams: [airbnb](https://github.com/airbnb/javascript), [idiomatic](https://github.com/rwaldron/idiomatic.js), [google/angular](https://github.com/angular/angular/), [facebook/react](https://github.com/facebook/react), [Microsoft/TypeScript](https://github.com/Microsoft/TypeScript/).

## Array

* Annotate arrays as `foos:Foo[]` instead of `foos:Array<Foo>`, unless you have a complex type expression; for example `Array<() => void>` is definitely more readable than `(() => void)[]`.

> Reasons: Its easier to read. Its used by the TypeScript team. Makes easier to know something is an array as the mind is trained to detect `[]`.

## Filename
Name files with `camelCase`. E.g. `accordian.tsx`, `myControl.tsx`, `utils.ts`, `map.ts` etc.

> Reason: Conventional across many JS teams.

## type vs. interface

* Use `type` when you *might* need a union or intersection:

```
type Foo = number | { someProperty: number }
```
* Use `interface` when you want `extends` or `implements` e.g

```
interface Foo {
  foo: string;
}
interface FooBar extends Foo {
  bar: string;
}
class X implements FooBar {
  foo: string;
  bar: string;
}
```
* Otherwise use whatever makes you happy that day.
