/*
 * View model for OctoPrint-BedReady
 *
 * Author: jneilliii
 * License: AGPLv3
 */
$(function () {
    function BedreadyViewModel(parameters) {
        var self = this;

        self.reference_images = ko.observableArray([]);
        self.taking_snapshot = ko.observable(false);
        self.popup_options = {
            title: 'Bed Not Ready',
            text: '',
            hide: false,
            type: 'error',
            addclass: 'bedready_notice',
            buttons: {
                sticker: false
            }
        };

        self.settingsViewModel = parameters[0];
        self.controlViewModel = parameters[1];
        
        // Crop editor variables
        self.canvas = null;
        self.ctx = null;
        self.img = null;
        self.isDragging = false;
        self.dragStartX = 0;
        self.dragStartY = 0;
        self.scale = 1;
        self.imageWidth = 0;
        self.imageHeight = 0;

        self.snapshot_valid = ko.pureComputed(function(){
            return self.settingsViewModel.webcam_snapshotUrl().length > 0 && self.settingsViewModel.webcam_snapshotUrl().startsWith('http');
        });

        self.onDataUpdaterPluginMessage = function (plugin, data) {
            if (plugin !== 'bedready') {
                return;
            }

            if (data.hasOwnProperty('similarity') && !data.bed_clear) {
                const similarity_pct = (parseFloat(data.similarity) * 100).toFixed(2);
                const reference_url = 'plugin/bedready/images/' + data.reference_image;
                const test_url = 'plugin/bedready/images/' + data.test_image;
                self.popup_options.text = `<div class="row-fluid"><p>Match percentage calculated as <span class="label label-info">${similarity_pct}%</span>.</p><p>Print job has been paused, check the bed and then resume.</p>Reference:<p><img src="${reference_url}"></img></p>Test:<p><img src="${test_url}"></img></p></div>`;
                self.popup_options.type = 'error';
                self.popup_options.title = 'Bed Not Ready';
                if (self.popup === undefined) {
                    self.popup = PNotify.singleButtonNotify(self.popup_options);
                } else {
                    self.popup.update(self.popup_options);
                    if (self.popup.state === 'closed'){
                        self.popup.open();
                    }
                }
            } else if (self.popup !== undefined && data.bed_clear) {
                self.popup.remove();
                self.popup = undefined;
            } else if (data.hasOwnProperty('error')) {
                self.popup_options.text = 'There was an error: ' + data.error.error;
                self.popup_options.type = 'error';
                self.popup_options.title = 'Bed Ready Error';
                if (self.popup === undefined) {
                    self.popup = PNotify.singleButtonNotify(self.popup_options);
                } else {
                    self.popup.update(self.popup_options);
                    if (self.popup.state === 'closed'){
                        self.popup.open();
                    }
                }
            }
        };

        self.delete_snapshot = function(filename) {
          OctoPrint.simpleApiCommand('bedready', 'delete_snapshot', {filename})
              .done(function (response) {
                self.reference_images.remove(filename);
                new PNotify({
                    title: 'Snapshot Deleted',
                    text: filename,
                    hide: true
                });
              })
              .fail(function(response) {
                new PNotify({
                    title: 'Bed Ready Error',
                    text: 'There was an error deleting the snapshot: ' + response.responseJSON.error,
                    hide: true
                });
              });
        }

        self.set_default_snapshot = function(filename) {
          self.settingsViewModel.settings.plugins.bedready.reference_image(filename);
        }

        self.take_snapshot = function() {
            self.taking_snapshot(true);
            OctoPrint.simpleApiCommand('bedready', 'take_snapshot', {name: "reference_" + (new Date()).toISOString() + ".jpg"})
                .done(function (response) {
                  self.reference_images(response);
                  self.taking_snapshot(false);
                })
                .fail(function (response) {
                  new PNotify({
                      title: 'Bed Ready Error',
                      text: 'There was an error saving the snapshot: ' + response.responseJSON.error,
                      hide: true
                  });
                  self.taking_snapshot(false);
                });
        };

        self.load_snapshots = function() {
          OctoPrint.simpleApiCommand('bedready', 'list_snapshots')
            .done(function (response) {
              self.reference_images(response);
            })
            .fail(function (response) {
              new PNotify({
                  title: 'Bed Ready Error',
                  text: 'Failed to load snapshots: ' + response.responseJSON.error,
                  hide: true
              });
            });
        }
        self.load_snapshots();

        // Crop editor functions
        self.imageLoaded = function() {
            self.img = document.getElementById('bedready-reference-image');
            self.canvas = document.getElementById('bedready-crop-canvas');
            if (!self.canvas || !self.img) return;
            
            self.ctx = self.canvas.getContext('2d');
            
            // Get actual image dimensions
            OctoPrint.simpleApiCommand('bedready', 'get_image_dimensions', {
                filename: self.settingsViewModel.settings.plugins.bedready.reference_image()
            }).done(function(response) {
                self.imageWidth = response.width;
                self.imageHeight = response.height;
                
                // Initialize crop coordinates if not set
                if (self.settingsViewModel.settings.plugins.bedready.crop_x2() === 0 ||
                    self.settingsViewModel.settings.plugins.bedready.crop_y2() === 0) {
                    self.settingsViewModel.settings.plugins.bedready.crop_x1(0);
                    self.settingsViewModel.settings.plugins.bedready.crop_y1(0);
                    self.settingsViewModel.settings.plugins.bedready.crop_x2(self.imageWidth);
                    self.settingsViewModel.settings.plugins.bedready.crop_y2(self.imageHeight);
                }
                
                self.drawCanvas();
            });
        };
        
        self.drawCanvas = function() {
            if (!self.canvas || !self.img || !self.ctx) return;
            
            // Set canvas size to fit container (max 800px wide)
            const maxWidth = 800;
            self.scale = Math.min(1, maxWidth / self.imageWidth);
            self.canvas.width = self.imageWidth * self.scale;
            self.canvas.height = self.imageHeight * self.scale;
            
            // Draw image
            self.ctx.drawImage(self.img, 0, 0, self.canvas.width, self.canvas.height);
            
            // Draw crop rectangle
            const x1 = self.settingsViewModel.settings.plugins.bedready.crop_x1() * self.scale;
            const y1 = self.settingsViewModel.settings.plugins.bedready.crop_y1() * self.scale;
            const x2 = self.settingsViewModel.settings.plugins.bedready.crop_x2() * self.scale;
            const y2 = self.settingsViewModel.settings.plugins.bedready.crop_y2() * self.scale;
            
            // Dim area outside crop
            self.ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
            self.ctx.fillRect(0, 0, self.canvas.width, y1);
            self.ctx.fillRect(0, y2, self.canvas.width, self.canvas.height - y2);
            self.ctx.fillRect(0, y1, x1, y2 - y1);
            self.ctx.fillRect(x2, y1, self.canvas.width - x2, y2 - y1);
            
            // Draw rectangle border
            self.ctx.strokeStyle = '#00ff00';
            self.ctx.lineWidth = 2;
            self.ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
            
            // Draw corner handles
            const handleSize = 8;
            self.ctx.fillStyle = '#00ff00';
            self.ctx.fillRect(x1 - handleSize/2, y1 - handleSize/2, handleSize, handleSize);
            self.ctx.fillRect(x2 - handleSize/2, y1 - handleSize/2, handleSize, handleSize);
            self.ctx.fillRect(x1 - handleSize/2, y2 - handleSize/2, handleSize, handleSize);
            self.ctx.fillRect(x2 - handleSize/2, y2 - handleSize/2, handleSize, handleSize);
        };
        
        self.startCrop = function(data, event) {
            const rect = self.canvas.getBoundingClientRect();
            const x = (event.clientX - rect.left) / self.scale;
            const y = (event.clientY - rect.top) / self.scale;
            
            self.isDragging = true;
            self.dragStartX = x;
            self.dragStartY = y;
            return false;
        };
        
        self.moveCrop = function(data, event) {
            if (!self.isDragging) return;
            
            const rect = self.canvas.getBoundingClientRect();
            const x = Math.max(0, Math.min(self.imageWidth, (event.clientX - rect.left) / self.scale));
            const y = Math.max(0, Math.min(self.imageHeight, (event.clientY - rect.top) / self.scale));
            
            const x1 = Math.min(self.dragStartX, x);
            const y1 = Math.min(self.dragStartY, y);
            const x2 = Math.max(self.dragStartX, x);
            const y2 = Math.max(self.dragStartY, y);
            
            self.settingsViewModel.settings.plugins.bedready.crop_x1(Math.round(x1));
            self.settingsViewModel.settings.plugins.bedready.crop_y1(Math.round(y1));
            self.settingsViewModel.settings.plugins.bedready.crop_x2(Math.round(x2));
            self.settingsViewModel.settings.plugins.bedready.crop_y2(Math.round(y2));
            
            self.drawCanvas();
            return false;
        };
        
        self.endCrop = function(data, event) {
            self.isDragging = false;
            return false;
        };
        
        self.cancelCrop = function(data, event) {
            self.isDragging = false;
            return false;
        };
        
        self.updateCropFromInputs = function() {
            // Validate and constrain values
            const x1 = Math.max(0, Math.min(self.imageWidth, parseInt(self.settingsViewModel.settings.plugins.bedready.crop_x1()) || 0));
            const y1 = Math.max(0, Math.min(self.imageHeight, parseInt(self.settingsViewModel.settings.plugins.bedready.crop_y1()) || 0));
            const x2 = Math.max(0, Math.min(self.imageWidth, parseInt(self.settingsViewModel.settings.plugins.bedready.crop_x2()) || self.imageWidth));
            const y2 = Math.max(0, Math.min(self.imageHeight, parseInt(self.settingsViewModel.settings.plugins.bedready.crop_y2()) || self.imageHeight));
            
            self.settingsViewModel.settings.plugins.bedready.crop_x1(x1);
            self.settingsViewModel.settings.plugins.bedready.crop_y1(y1);
            self.settingsViewModel.settings.plugins.bedready.crop_x2(x2);
            self.settingsViewModel.settings.plugins.bedready.crop_y2(y2);
            
            self.drawCanvas();
        };
        
        self.resetCrop = function() {
            self.settingsViewModel.settings.plugins.bedready.crop_x1(0);
            self.settingsViewModel.settings.plugins.bedready.crop_y1(0);
            self.settingsViewModel.settings.plugins.bedready.crop_x2(self.imageWidth);
            self.settingsViewModel.settings.plugins.bedready.crop_y2(self.imageHeight);
            self.drawCanvas();
        };

        self.test_snapshot = function () {
            self.taking_snapshot(true);
            OctoPrint.simpleApiCommand('bedready', 'check_bed', {reference: self.settingsViewModel.settings.plugins.bedready.reference_image()})
                .done(function (response) {
                    const similarity_pct = (parseFloat(response.similarity) * 100).toFixed(2);
                    const reference_url = 'plugin/bedready/images/' + response.reference_image;
                    const test_url = 'plugin/bedready/images/' + response.test_image;
                    self.popup_options.text = `<div class="row-fluid"><p>Match percentage calculated as <span class="label label-info">${similarity_pct}%</span>.</p>Reference:<p><img src="${reference_url}"></img></p>Test:<p><img src="${test_url}"></img></p></div>`;
                    if (parseFloat(response.similarity) < parseFloat(self.settingsViewModel.settings.plugins.bedready.match_percentage())) {
                        self.popup_options.type = 'error';
                    } else {
                        self.popup_options.type = 'success';
                    }

                    self.popup_options.title = 'Bed Ready Test';
                    if (self.popup === undefined) {
                        self.popup = PNotify.singleButtonNotify(self.popup_options);
                    } else {
                        self.popup.update(self.popup_options);
                        if (self.popup.state === 'closed') {
                            self.popup.open();
                        }
                    }
                    self.taking_snapshot(false);
                });
        };
    }

    OCTOPRINT_VIEWMODELS.push({
        construct: BedreadyViewModel,
        dependencies: ['settingsViewModel', 'controlViewModel'],
        elements: ['#settings_plugin_bedready']
    });
});
