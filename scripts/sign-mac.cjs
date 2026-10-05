const {signAsync} = require('@electron/osx-sign');
// Seal every nested binary and app resource without requiring a developer account.
// Ad-hoc signing provides integrity; it does not provide Apple notarization.
module.exports = async options => {
  await signAsync({...options, identity: '-', identityValidation: false,
    preAutoEntitlements: false, preEmbedProvisioningProfile: false,
    optionsForFile: file => ({...options.optionsForFile(file), timestamp: 'none'})});
};
