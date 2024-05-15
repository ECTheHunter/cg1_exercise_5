// custom imports
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

// local from us provided utilities
import * as utils from './lib/utils';
import RenderWidget from './lib/rendererWidget';
import { Application, createWindow } from './lib/window';

// helper lib, provides exercise dependent prewritten Code
import * as helper from './helper';
import { CanvasWidget } from './canvasWidget';

function main() {
    let root = Application("Raycasting");
    root.setLayout([["left", "right"]]);
    root.setLayoutColumns(["50%", "50%"]);
    root.setLayoutRows(["100%"]);

    let settings = new helper.Settings();
    let gui = helper.createGUI(settings);
    gui.show();
    settings.addCallback(callback);

    let canDiv = createWindow("left");
    root.appendChild(canDiv);

    // Initialize CanvasWidget with initial dimensions
    const canvasWidget = new CanvasWidget(canDiv, settings.width, settings.height);

    function callback(changed: utils.KeyValuePair<helper.Settings>) {
        if (changed.key == "width") {
            canvasWidget.changeDimensions(changed.value, settings.height)
        }
        if (changed.key == "height") {
            canvasWidget.changeDimensions(settings.width, changed.value)
        }


    }
    settings.saveImg = () => canvasWidget.savePNG();
    settings.render = () => rayTrace(canvasWidget, settings);

    let rendererDiv = createWindow("right");
    root.appendChild(rendererDiv);

    // create renderer
    let renderer = new THREE.WebGLRenderer({
        antialias: true,
    });

    // create scene
    let scene = new THREE.Scene();

    // create camera
    let camera = new THREE.PerspectiveCamera();
    helper.setupCamera(camera);
    helper.setupLight(scene);

    // create controls
    let controls = new OrbitControls(camera, rendererDiv);
    helper.setupControls(controls);
    helper.setupGeometry(scene);
    // Pass CanvasWidget to RenderWidget constructor
    let wid = new RenderWidget(rendererDiv, renderer, camera, scene, controls);
    wid.animate();
    function rayTrace(canvasWidget: CanvasWidget, settings: helper.Settings) {

        const canwidth = settings.width;
        const canheight = settings.height;
        const ctx = canvasWidget.Canvas.getContext('2d');


        ctx!.clearRect(0, 0, canvasWidget.Canvas.width, canvasWidget.Canvas.height);
        const rootValue = Math.sqrt(settings.subsamples);
        const subpixelSize = 1 / rootValue;

        for (let y = 0; y < canheight; y++) {
            for (let x = 0; x < canwidth; x++) {
                let colorSum = new THREE.Color(0, 0, 0);


                for (let i = 0; i < rootValue; i++) {
                    for (let j = 0; j < rootValue; j++) {


                        const subX = x + i * subpixelSize;
                        const subY = y + j * subpixelSize;

                        const raycaster = new THREE.Raycaster();
                        const rayDirection = new THREE.Vector2(
                            (subX / canwidth) * 2 - 1,
                            -(subY / canheight) * 2 + 1
                        );
                        raycaster.setFromCamera(rayDirection, camera);
                        const intersects = raycaster.intersectObjects(scene.children, true);

                        if (intersects.length > 0) {
                            const object = intersects[0].object;
                            const material = (object as THREE.Mesh).material as THREE.MeshPhongMaterial & { mirror: boolean };
                            if (material && material.color) {
                                let color = material.color;
                                if (settings.phong) {
                                    let finalColor = new THREE.Color(0, 0, 0);


                                    const lightsToConsider = settings.alllights ? scene.children.filter(child => child instanceof THREE.PointLight) : [scene.children.find(child => child instanceof THREE.PointLight)];

                                    lightsToConsider.forEach(light => {
                                        const pointLight = light as THREE.PointLight;
                                        const lightintensity = pointLight.intensity;
                                        const lightColor = pointLight.color;


                                        const lightDirection = new THREE.Vector3().copy(light!.position).sub(intersects[0].point);


                                        const distanceSquared = lightDirection.lengthSq();
                                        const attenuation = 1 / distanceSquared;
                                        const distance = lightDirection.length();

                                        lightDirection.normalize();
                                        if (settings.shadows) {
                                            const shadowRaycaster = new THREE.Raycaster(intersects[0].point, lightDirection);
                                            const shadowIntersects = shadowRaycaster.intersectObjects(scene.children, true);


                                            const isInShadow = shadowIntersects.length > 0 && shadowIntersects[0].distance < distance;


                                            if (isInShadow) return;
                                        }

                                        let normal;
                                        normal = intersects[0].face?.normal.clone().transformDirection(object.matrixWorld).normalize();


                                        const viewDirection = new THREE.Vector3().copy(camera.position).sub(intersects[0].point).normalize();


                                        const halfVector = new THREE.Vector3().copy(lightDirection).add(viewDirection).normalize();


                                        const diffuse = Math.max(normal!.dot(lightDirection), 0);

                                        const specular = Math.pow(Math.max(normal!.dot(halfVector), 0), material.shininess) * material.shininess / 2;


                                        const diffuseColor = new THREE.Color().copy(material.color).multiply(lightColor).multiplyScalar(diffuse).multiplyScalar(lightintensity);
                                        const specularColor = new THREE.Color().copy(material.specular).multiply(lightColor).multiplyScalar(specular).multiplyScalar(lightintensity);

                                        finalColor.add(diffuseColor.multiplyScalar(attenuation));
                                        finalColor.add(specularColor.multiplyScalar(attenuation));
                                    });

                                    color = finalColor;
                                }
                                if (material.mirror && settings.mirrors && settings.maxDepth > 0) {

                                    const reflectionColor = mirrorReflect(intersects[0], raycaster.ray.direction, settings, settings.maxDepth);

                                    color.lerp(reflectionColor, material.reflectivity);
                                }
                                colorSum.add(color);
                               
                            }
                            const averagedColor = colorSum.multiplyScalar(1 / rootValue);
                            canvasWidget.setPixel(x, y, averagedColor);
                            if (settings.correctSpheres) {
                                scene.traverse((child) => {
                                    if (child instanceof THREE.Mesh && child.geometry instanceof THREE.SphereGeometry) {
                                        const sphere = child;
                                        const sphereCenter = sphere.position;
                                        const radius = sphere.geometry.parameters.radius;
                                        const rayOrigin = raycaster.ray.origin;
                                        const rayDirection = raycaster.ray.direction.clone().normalize();
                                        const oc = rayOrigin.clone().sub(sphereCenter);
                                        const a = rayDirection.dot(rayDirection);
                                        const b = 2.0 * oc.dot(rayDirection);
                                        const c = oc.dot(oc) - radius * radius;
                                        const discriminant = b * b - 4 * a * c;
                                        if (discriminant >= 0) {
                                            const t = (-b + Math.sqrt(discriminant)) / (2 * a);
                                            if (t >= 0) {
                                                const material = (child as THREE.Mesh).material as THREE.MeshPhongMaterial;
                                                if (material && material.color) {

                                                    let color = material.color;
                                                    if (settings.phong) {
                                                        let finalColor = new THREE.Color(0, 0, 0);


                                                        const lightsToConsider = settings.alllights ? scene.children.filter(child => child instanceof THREE.PointLight) : [scene.children.find(child => child instanceof THREE.PointLight)];

                                                        lightsToConsider.forEach(light => {
                                                            const pointLight = light as THREE.PointLight;
                                                            const lightintensity = pointLight.intensity;
                                                            const lightColor = pointLight.color;


                                                            const lightDirection = new THREE.Vector3().copy(light!.position).sub(intersects[0].point);

                                                            const distanceSquared = lightDirection.lengthSq();
                                                            const attenuation = 1 / distanceSquared;
                                                            const distance = lightDirection.length();

                                                            lightDirection.normalize();
                                                            if (settings.shadows) {
                                                                const shadowRaycaster = new THREE.Raycaster(intersects[0].point, lightDirection);
                                                                const shadowIntersects = shadowRaycaster.intersectObjects(scene.children, true);


                                                                const isInShadow = shadowIntersects.length > 0 && shadowIntersects[0].distance < distance;


                                                                if (isInShadow) return;
                                                            }


                                                            let normal;

                                                            const sphereCenter = object.position;
                                                            normal = new THREE.Vector3().copy(intersects[0].point).sub(sphereCenter).normalize();



                                                            const viewDirection = new THREE.Vector3().copy(camera.position).sub(intersects[0].point).normalize();


                                                            const halfVector = new THREE.Vector3().copy(lightDirection).add(viewDirection).normalize();


                                                            const diffuse = Math.max(normal!.dot(lightDirection), 0);


                                                            const specular = Math.pow(Math.max(normal!.dot(halfVector), 0), material.shininess) * material.shininess / 4;


                                                            const diffuseColor = new THREE.Color().copy(material.color).multiply(lightColor).multiplyScalar(diffuse).multiplyScalar(lightintensity);
                                                            const specularColor = new THREE.Color().copy(material.specular).multiply(lightColor).multiplyScalar(specular).multiplyScalar(lightintensity);


                                                            finalColor.add(diffuseColor.multiplyScalar(attenuation));
                                                            finalColor.add(specularColor.multiplyScalar(attenuation));
                                                        });

                                                        color = finalColor;
                                                    }

                                                    colorSum.add(color);
                                                   
                                                }
                                                const averagedColor = colorSum.multiplyScalar(1 / rootValue);
                                                canvasWidget.setPixel(x, y, averagedColor);
                                            }
                                        }
                                    }


                                });




                            }
                        }
                    }
                }
            }



                    }
                }

               
                        
            function mirrorReflect(intersection: THREE.Intersection, rayDirection: THREE.Vector3, settings: helper.Settings, recursionDepth: number): THREE.Color {

                if (recursionDepth <= 0 || !intersection) {
                    return new THREE.Color(0, 0, 0);
                }


                const normal = intersection.face?.normal.clone().transformDirection(intersection.object.matrixWorld).normalize();
                const reflectionDirection = rayDirection.clone().reflect(normal!).normalize();


                const reflectionRaycaster = new THREE.Raycaster(intersection.point, reflectionDirection);
                const reflectionIntersects = reflectionRaycaster.intersectObjects(scene.children, true);

                if (reflectionIntersects.length > 0) {
                    const reflectedObject = reflectionIntersects[0].object;
                    const reflectedMaterial = (reflectedObject as THREE.Mesh).material as THREE.MeshPhongMaterial & { mirror: boolean };
                    const reflectionColor = mirrorReflect(reflectionIntersects[0], reflectionDirection, settings, recursionDepth - 1);
                    const materialColor = new THREE.Color().copy(reflectedMaterial.color);

                    const isMirror = reflectedMaterial && reflectedMaterial.mirror;


                    if (!isMirror) {

                        return materialColor.add(reflectionColor);
                    }
                    else {
                        return new THREE.Color(0, 0, 0);
                    }
                } else {

                    return new THREE.Color(0, 0, 0);
                }
            }


        }

        // call main entrypoint
        main();
