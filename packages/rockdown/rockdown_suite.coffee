this.rockdownSuite = [

# very first line must indent to be legal CoffeeScript.
# This string literal comes out as "foo".
 """
foo
"""
-> """document(textBlock(foo))"""

"""
foo
bar
baz
"""
-> """document(textBlock(foo `
` bar `
` baz))"""

"""
* foo
* bar
* baz
"""
-> """document(ul(
liCompact(textBlock(foo))
liCompact(textBlock(bar))
liCompact(textBlock(baz))))"""

"""
* foo
bar
* baz
"""
-> """document(ul(
liCompact(textBlock(foo `\n` bar))
liCompact(textBlock(baz))))"""

"""
* foo
> bar
* baz
"""
-> """document(
ul(liCompact(textBlock(foo)))
blockquote(textBlock(bar))
ul(liCompact(textBlock(baz))))"""

"""
* * * foo
"""
-> """document(ul(liCompact(ul(liCompact(ul(liCompact(
textBlock(foo))))))))"""

"""
* foo
  * bar
    * baz
  * qux
* blah
"""
-> """document(
ul(liCompact(textBlock(foo)
             ul(liCompact(textBlock(bar)
                          ul(liCompact(textBlock(baz))))
                liCompact(textBlock(qux))))
   liCompact(textBlock(blah))))"""

"""
> > * > foo
bar
baz
"""
-> """document(blockquote(blockquote(ul(liCompact(blockquote(
textBlock(foo `\n` bar `\n` baz)))))))"""

]
