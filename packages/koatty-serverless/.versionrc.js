module.exports = {
    releaseCommitMessageFormat: "build: v{{currentTag}}",
    bumpFiles: [{ filename: "package.json", type: "json" }],
};
