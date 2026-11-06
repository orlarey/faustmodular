# A Faust store

A **store** of Faust modules and scenes, for [faustmodular](https://orlarey.github.io/faustmodular/) and faustcode
(the specification: `Documentation/STORE-SPEC.md` of faustmodular).

- `fauststore.json`: the manifest (its name, description, author, license: edit them).
- `modules/<Name>/<Name>.dsp`: a module, a Faust program described by its `declare` (name, author, license, summary,
  function, inlets, outlets) and its DESCRIPTION comment.
- `scenes/<Name>/<Name>.jfaust`: a scene, the file faustmodular saves (it contains the code of its modules).

To use it: in faustmodular, Modules menu, *Stores*, *Add a store…*, and type `owner/repository`. Its modules are
in the library; its scenes in File ▸ Open from a store. A scene opens from a link:
`https://orlarey.github.io/faustmodular/?store=<owner>/<repository>&scene=scenes/Nappe/Nappe.jfaust`.

Add the topic `fauststore` to the repository, so that others find it.
