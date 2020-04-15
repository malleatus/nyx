## nvim
If using neoclide/coc.nvim with `coc-eslint`, it is recommended to do the following:

```sh
mkdir .vim
cat << EOF > .vim/coc-settings.json
{
  "eslint.options": {
    "configFile": "/Users/hjdivad/src/malleatus/nyx/.eslintrc.base.js",
    "useEslintrc": false
  }
}
EOF
echo '/.vim' >> .git/info/exclude
```

This way `yarn lint --fix` will still format source files with prettier, but in-editor diagnostics will not complain about formatting.
