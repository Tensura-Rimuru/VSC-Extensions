import { __testing, getDocCommentRanges, getRustFoldingRanges } from '../src/folding';

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function deepEqual(actual: unknown, expected: unknown, message: string): void {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    assert(a === e, `${message}\nExpected: ${e}\nActual:   ${a}`);
}
function test(name: string, fn: () => void): void {
    fn();
    console.log(`PASS: ${name}`);
}
test('folds consecutive module documentation comments', () => {
    const source = [
        '//! module docs line 1',
        '//! module docs line 2',
        '//! module docs line 3',
        '',
        'use std::sync::Arc;',
    ];

    deepEqual(getDocCommentRanges(source), [
        { start: 0, end: 2, kind: 'comment' },
    ], 'Module documentation comments should fold.');
});
test('folds consecutive item documentation comments separately', () => {
    const source = [
        '/// line 1',
        '/// line 2',
        'pub fn foo() {',
        '    todo!();',
        '}',
    ];

    deepEqual(getDocCommentRanges(source), [
        { start: 0, end: 1, kind: 'comment' },
    ], 'Item documentation comments should fold.');
});
test('keeps module and item documentation blocks separate', () => {
    const source = [
        '//! module',
        '//! module continued',
        '/// item docs',
        '/// item docs continued',
    ];

    deepEqual(getDocCommentRanges(source), [
        { start: 0, end: 1, kind: 'comment' },
        { start: 2, end: 3, kind: 'comment' },
    ], 'Module and item comments should remain separate.');
});
test('folds async generic function including multiline where clause', () => {
    const source = `pub fn transient_async<T, F, Fut>(&mut self, f: F)
where
    T: Send + Sync + 'static,
    F: Fn(&ServiceProvider) -> Fut + Send + Sync + 'static,
    Fut: Future<Output = T> + Send + 'static
{
    self.register_async(Lifetime::Transient, f);
}
`;

    const ranges = getRustFoldingRanges(source);
    deepEqual(ranges, [
        { start: 0, end: 7, kind: 'syntax' },
    ], 'Multiline where clause should be included.');
});

test('folds a function from the declaration line, not the opening brace line', () => {
    const source = `async fn get_singleton_async<T: Send + Sync + 'static>(&self, type_id: TypeId, f: &AsyncFactory) -> Arc<T> {
    if let Some(service) = self.singletons.read().unwrap().get(&type_id) {
        return service.clone().downcast::<T>().unwrap();
    }
    let text = r#"fn fake() { }"#;
    let instance = f(self).await;
    self.singletons.write().unwrap()
        .entry(type_id)
        .or_insert(instance)
        .clone()
        .downcast::<T>().unwrap();
}
`;

    deepEqual(getRustFoldingRanges(source), [
        { start: 0, end: 11, kind: 'syntax' },
        { start: 1, end: 3, kind: 'syntax' },
    ], 'Function should fold from declaration line.');
});

test('does not fold declaration-only functions', () => {
    deepEqual(
        getRustFoldingRanges('fn declaration_only();\n'),
        [],
        'Declaration-only function should not fold.',
    );
});

test('ignores fn and braces in comments and strings', () => {
    const source = String.raw`fn outer() {
    // fn commented() { }
    /* nested /* fn ignored() { } */ comment */
    let x = "fn string() { }";
    let y = r###"fn raw() { }"###;
    let z = 'x';
}
`;
    deepEqual(getRustFoldingRanges(source), [
        { start: 0, end: 6, kind: 'syntax' },
    ], 'Strings and comments must not create false functions.');
});

test('folds multiline non-function Rust brace blocks', () => {
    const source = `impl ServiceProvider {
    pub fn foo(&self) {
        if true {
            println!("ok");
        }
    }
}
`;
    deepEqual(getRustFoldingRanges(source), [
        { start: 0, end: 6, kind: 'syntax' },
        { start: 1, end: 5, kind: 'syntax' },
        { start: 2, end: 4, kind: 'syntax' },
    ], 'Multiline brace blocks should fold.');
});

test('lexer only sees real fn keywords', () => {
    const source = String.raw`fn real() {}
// fn comment() {}
let s = "fn string() {}";
let r = r#"fn raw() {}"#;
`;
    assert(
        __testing.lexRust(source).filter(token => token.type === 'fn').length === 1,
        'Only the real fn keyword should be lexed.'
    );
});
